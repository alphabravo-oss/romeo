import type { DataConnector, LocalImportSyncItem } from "../domain/entities";
import { ApiError } from "../errors";
import { extractFeedText } from "./feed-extraction";
import {
  retryConnectorResponse,
  type DataConnectorRetryPolicy,
} from "./data-connector-retry";
import { dnsPinnedFetch, type DnsPinnedFetch } from "./dns-pinned-fetch";
import {
  assertConnectorHostAllowed,
  hostMatchesDomainRule,
  isRedirectResponse,
  normalizeHost,
  normalizeAllowedHosts,
  type WebsiteConnectorEgressPolicy,
  type WebsiteConnectorHostAddress,
  type WebsiteConnectorHostLookup,
} from "./data-connector-network-policy";
import {
  mimeTypeFromKey,
  normalizeFeedMimeType,
  normalizeTextMimeType,
  readConnectorUrl,
  readS3Config,
  rssFileName,
  s3FileName,
  websiteFileName,
} from "./data-connector-content";

export * from "./data-connector-network-policy";

export interface DataConnectorExecutionResult {
  items: LocalImportSyncItem[];
  summary?: Record<string, unknown>;
}

export interface DataConnectorExecutor {
  sync(connector: DataConnector): Promise<DataConnectorExecutionResult>;
}

export interface S3ConnectorObject {
  key: string;
  contentType?: string;
  sizeBytes?: number;
}

export interface S3ConnectorReadResult {
  body: Uint8Array;
  contentType?: string;
}

export interface S3ConnectorReader {
  listObjects(input: {
    bucket: string;
    maxKeys: number;
    prefix: string;
    region: string;
    secretRef?: string;
  }): Promise<S3ConnectorObject[]>;
  getObject(input: {
    bucket: string;
    key: string;
    region: string;
    secretRef?: string;
  }): Promise<S3ConnectorReadResult | undefined>;
}

export const disabledDataConnectorExecutor: DataConnectorExecutor = {
  async sync() {
    throw new ApiError(
      "connector_execution_disabled",
      "Connector execution is disabled until worker, network, and secret policies are configured.",
      409,
    );
  },
};

export class S3DataConnectorExecutor implements DataConnectorExecutor {
  private readonly maxBytes: number;
  private readonly maxItems: number;

  constructor(
    private readonly reader: S3ConnectorReader,
    options: { maxBytes?: number; maxItems?: number } = {},
  ) {
    this.maxBytes = options.maxBytes ?? 2_000_000;
    this.maxItems = options.maxItems ?? 50;
  }

  async sync(connector: DataConnector): Promise<DataConnectorExecutionResult> {
    if (connector.type !== "s3")
      return disabledDataConnectorExecutor.sync(connector);
    const config = readS3Config(connector);
    const maxItems = Math.min(config.maxItems, this.maxItems);
    const listed = await this.reader.listObjects({
      bucket: config.bucket,
      prefix: config.prefix,
      region: config.region,
      maxKeys: maxItems,
      ...(config.secretRef === undefined
        ? {}
        : { secretRef: config.secretRef }),
    });
    if (listed.length > maxItems)
      throw new ApiError(
        "connector_item_limit_exceeded",
        "S3 connector returned too many objects.",
        413,
        { maxItems },
      );

    const items: LocalImportSyncItem[] = [];
    let totalBytes = 0;
    for (const object of listed) {
      if (!object.key.startsWith(config.prefix)) {
        throw new ApiError(
          "connector_s3_key_outside_prefix",
          "S3 connector returned an object outside its configured prefix.",
          400,
        );
      }
      if (object.sizeBytes !== undefined && object.sizeBytes > this.maxBytes) {
        throw new ApiError(
          "connector_response_too_large",
          "S3 connector object exceeds the configured size limit.",
          413,
        );
      }
      const objectBody = await this.reader.getObject({
        bucket: config.bucket,
        key: object.key,
        region: config.region,
        ...(config.secretRef === undefined
          ? {}
          : { secretRef: config.secretRef }),
      });
      if (objectBody === undefined) continue;
      const mimeType = normalizeTextMimeType(
        objectBody.contentType ??
          object.contentType ??
          mimeTypeFromKey(object.key),
        "S3 connector object must be a supported text content type.",
      );
      if (objectBody.body.byteLength > this.maxBytes) {
        throw new ApiError(
          "connector_response_too_large",
          "S3 connector object exceeds the configured size limit.",
          413,
        );
      }
      totalBytes += objectBody.body.byteLength;
      items.push({
        fileName: s3FileName(object.key, config.prefix),
        mimeType,
        content: new TextDecoder().decode(objectBody.body),
        sizeBytes: objectBody.body.byteLength,
      });
    }

    return {
      items,
      summary: {
        bucket: config.bucket,
        prefix: config.prefix,
        region: config.region,
        objectCount: items.length,
        totalByteLength: totalBytes,
      },
    };
  }
}

export class WebsiteDataConnectorExecutor implements DataConnectorExecutor {
  private readonly fetchImpl: typeof fetch;
  private readonly maxBytes: number;
  private readonly timeoutMs: number;
  private readonly allowedHosts: string[];
  private readonly blockedHosts: string[];
  private readonly egressPolicy: WebsiteConnectorEgressPolicy;
  private readonly hostLookup: WebsiteConnectorHostLookup | undefined;
  private readonly pinnedFetchImpl: DnsPinnedFetch | undefined;
  private readonly retryPolicy: DataConnectorRetryPolicy;

  constructor(
    options: {
      allowedHosts?: string[];
      blockedHosts?: string[];
      egressPolicy?: WebsiteConnectorEgressPolicy;
      fetchImpl?: typeof fetch;
      hostLookup?: WebsiteConnectorHostLookup;
      pinnedFetchImpl?: DnsPinnedFetch;
      maxBytes?: number;
      retryAttempts?: number;
      retryBackoffMs?: number;
      timeoutMs?: number;
    } = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxBytes = options.maxBytes ?? 2_000_000;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.allowedHosts = normalizeAllowedHosts(options.allowedHosts);
    this.blockedHosts = normalizeAllowedHosts(options.blockedHosts);
    this.egressPolicy = options.egressPolicy ?? "allow_public";
    this.hostLookup = options.hostLookup;
    this.pinnedFetchImpl =
      options.pinnedFetchImpl ??
      (options.fetchImpl === undefined ? dnsPinnedFetch : undefined);
    this.retryPolicy = {
      retryAttempts: options.retryAttempts ?? 1,
      retryBackoffMs: options.retryBackoffMs ?? 250,
    };
  }

  async sync(connector: DataConnector): Promise<DataConnectorExecutionResult> {
    if (connector.type === "rss") return this.syncRss(connector);
    if (connector.type !== "website")
      return disabledDataConnectorExecutor.sync(connector);
    const url = readConnectorUrl(connector);
    const response = await this.fetchText(url, {
      accept: "text/html,text/plain,text/markdown;q=0.9,*/*;q=0.1",
      normalizeMimeType: normalizeTextMimeType,
      unsupportedMessage:
        "Website connector response must be a supported text content type.",
    });
    return {
      items: [
        {
          fileName: websiteFileName(url, response.mimeType),
          mimeType: response.mimeType,
          content: response.content,
          sizeBytes: response.sizeBytes,
        },
      ],
      summary: {
        fetchedHost: url.hostname,
        fetchedPath: url.pathname || "/",
        contentType: response.mimeType,
        fetchedByteLength: response.sizeBytes,
        pageCount: 1,
      },
    };
  }

  /** Governed single-page fetch used by interactive URL attachments. */
  async fetchUrl(urlValue: string): Promise<{
    content: string;
    finalUrl: string;
    mimeType: string;
    sizeBytes: number;
  }> {
    let url: URL;
    try {
      url = new URL(urlValue);
    } catch {
      throw new ApiError(
        "connector_url_invalid",
        "Website URL is invalid.",
        400,
      );
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new ApiError(
        "connector_url_protocol_invalid",
        "Website URL must use HTTP or HTTPS.",
        400,
      );
    }
    return this.fetchText(url, {
      accept: "text/html,text/plain,text/markdown;q=0.9,*/*;q=0.1",
      normalizeMimeType: normalizeTextMimeType,
      unsupportedMessage:
        "Website response must be a supported text content type.",
    });
  }

  private async syncRss(
    connector: DataConnector,
  ): Promise<DataConnectorExecutionResult> {
    const url = readConnectorUrl(connector);
    const response = await this.fetchText(url, {
      accept:
        "application/rss+xml,application/atom+xml,application/xml,text/xml;q=0.9,*/*;q=0.1",
      normalizeMimeType: normalizeFeedMimeType,
      unsupportedMessage:
        "RSS connector response must be an RSS, Atom, or XML content type.",
    });
    const feed = extractFeedText(response.content, connector.config.maxItems);
    return {
      items: [
        {
          fileName: rssFileName(url),
          mimeType: "text/markdown",
          content: feed.content,
          sizeBytes: new TextEncoder().encode(feed.content).length,
        },
      ],
      summary: {
        fetchedHost: url.hostname,
        fetchedPath: url.pathname || "/",
        contentType: response.mimeType,
        fetchedByteLength: response.sizeBytes,
        feedItemCount: feed.itemCount,
        pageCount: 1,
      },
    };
  }

  private async fetchText(
    url: URL,
    options: {
      accept: string;
      normalizeMimeType: (
        contentType: string | null,
        unsupportedMessage: string,
      ) => string;
      unsupportedMessage: string;
    },
  ): Promise<{
    content: string;
    finalUrl: string;
    mimeType: string;
    sizeBytes: number;
  }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    let currentUrl = url;
    try {
      for (let redirectCount = 0; ; redirectCount += 1) {
        const approvedAddresses = await this.assertHostAllowed(currentUrl);
        const request = () =>
          this.fetchWithTimeout(
            currentUrl,
            options.accept,
            controller.signal,
            approvedAddresses,
          );
        response = await retryConnectorResponse(request, this.retryPolicy);
        if (!isRedirectResponse(response)) break;
        const location = response.headers.get("location");
        if (location === null) break;
        if (redirectCount >= 5) {
          throw new ApiError(
            "connector_redirect_limit_exceeded",
            "Website connector exceeded the redirect limit.",
            502,
          );
        }
        const redirected = new URL(location, currentUrl);
        if (
          redirected.protocol !== "https:" &&
          redirected.protocol !== "http:"
        ) {
          throw new ApiError(
            "connector_url_protocol_invalid",
            "Website URL must use HTTP or HTTPS.",
            400,
          );
        }
        currentUrl = redirected;
      }
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok)
      throw new ApiError(
        "connector_fetch_failed",
        "Website connector fetch failed.",
        502,
        { status: response.status },
      );
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > this.maxBytes) {
      throw new ApiError(
        "connector_response_too_large",
        "Website connector response exceeds the configured size limit.",
        413,
      );
    }
    const mimeType = options.normalizeMimeType(
      response.headers.get("content-type"),
      options.unsupportedMessage,
    );
    const body = await response.arrayBuffer();
    if (body.byteLength > this.maxBytes) {
      throw new ApiError(
        "connector_response_too_large",
        "Website connector response exceeds the configured size limit.",
        413,
      );
    }
    return {
      content: new TextDecoder().decode(body),
      finalUrl: currentUrl.toString(),
      mimeType,
      sizeBytes: body.byteLength,
    };
  }

  private async fetchWithTimeout(
    url: URL,
    accept: string,
    signal: AbortSignal,
    approvedAddresses: WebsiteConnectorHostAddress[],
  ): Promise<Response> {
    try {
      const init: RequestInit = {
        headers: {
          accept,
          "user-agent": "RomeoDataConnector/0.1",
        },
        redirect: "manual",
        signal,
      };
      return this.pinnedFetchImpl === undefined ||
        approvedAddresses.length === 0
        ? await this.fetchImpl(url.toString(), init)
        : await this.pinnedFetchImpl(url, init, approvedAddresses);
    } catch {
      throw new ApiError(
        "connector_fetch_failed",
        "Website connector fetch failed.",
        502,
      );
    }
  }

  private async assertHostAllowed(
    url: URL,
  ): Promise<WebsiteConnectorHostAddress[]> {
    const host = normalizeHost(url.hostname);
    if (this.blockedHosts.some((rule) => hostMatchesDomainRule(host, rule))) {
      throw new ApiError(
        "connector_egress_host_blocked",
        "Connector host is blocked by the configured egress policy.",
        403,
        { host },
      );
    }
    return await assertConnectorHostAllowed(url, {
      allowedHosts: this.allowedHosts,
      egressPolicy: this.egressPolicy,
      ...(this.hostLookup === undefined ? {} : { hostLookup: this.hostLookup }),
    });
  }
}

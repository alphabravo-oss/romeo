import type { DataConnector, LocalImportSyncItem } from "../domain/entities";
import { ApiError } from "../errors";
import { extractFeedText } from "./feed-extraction";
import {
  retryConnectorResponse,
  type DataConnectorRetryPolicy,
} from "./data-connector-retry";

export interface DataConnectorExecutionResult {
  items: LocalImportSyncItem[];
  summary?: Record<string, unknown>;
}

export interface DataConnectorExecutor {
  sync(connector: DataConnector): Promise<DataConnectorExecutionResult>;
}

export type WebsiteConnectorEgressPolicy = "allow_public" | "require_allowlist";
export interface WebsiteConnectorHostAddress {
  address: string;
  family: 4 | 6;
}
export type WebsiteConnectorHostLookup = (
  hostname: string,
) => Promise<WebsiteConnectorHostAddress[]>;

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
  private readonly egressPolicy: WebsiteConnectorEgressPolicy;
  private readonly hostLookup: WebsiteConnectorHostLookup | undefined;
  private readonly retryPolicy: DataConnectorRetryPolicy;

  constructor(
    options: {
      allowedHosts?: string[];
      egressPolicy?: WebsiteConnectorEgressPolicy;
      fetchImpl?: typeof fetch;
      hostLookup?: WebsiteConnectorHostLookup;
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
    this.egressPolicy = options.egressPolicy ?? "allow_public";
    this.hostLookup = options.hostLookup;
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
  ): Promise<{ content: string; mimeType: string; sizeBytes: number }> {
    await this.assertHostAllowed(url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      const request = () =>
        this.fetchWithTimeout(url, options.accept, controller.signal);
      response = await retryConnectorResponse(request, this.retryPolicy);
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
      mimeType,
      sizeBytes: body.byteLength,
    };
  }

  private async fetchWithTimeout(
    url: URL,
    accept: string,
    signal: AbortSignal,
  ): Promise<Response> {
    try {
      return await this.fetchImpl(url.toString(), {
        headers: {
          accept,
          "user-agent": "RomeoDataConnector/0.1",
        },
        redirect: "manual",
        signal,
      });
    } catch {
      throw new ApiError(
        "connector_fetch_failed",
        "Website connector fetch failed.",
        502,
      );
    }
  }

  private async assertHostAllowed(url: URL): Promise<void> {
    await assertConnectorHostAllowed(url, {
      allowedHosts: this.allowedHosts,
      egressPolicy: this.egressPolicy,
      ...(this.hostLookup === undefined ? {} : { hostLookup: this.hostLookup }),
    });
  }
}

export async function assertConnectorHostAllowed(
  url: URL,
  options: {
    allowedHosts?: string[];
    egressPolicy?: WebsiteConnectorEgressPolicy;
    hostLookup?: WebsiteConnectorHostLookup;
  } = {},
): Promise<void> {
  const allowedHosts = normalizeAllowedHosts(options.allowedHosts);
  const egressPolicy = options.egressPolicy ?? "allow_public";
  const hostLookup = options.hostLookup;
  const host = normalizeHost(url.hostname);
  if (isBlockedConnectorHost(host)) {
    throw new ApiError(
      "connector_private_network_host_blocked",
      "Connector host resolves to a private or local network.",
      403,
      { host },
    );
  }
  if (allowedHosts.length === 0) {
    if (egressPolicy === "require_allowlist") {
      throw new ApiError(
        "connector_egress_allowlist_required",
        "Connector egress policy requires a host allowlist.",
        403,
      );
    }
  } else if (!allowedHosts.some((rule) => hostMatchesRule(host, rule))) {
    throw new ApiError(
      "connector_egress_host_blocked",
      "Connector host is not in the configured egress allowlist.",
      403,
      { host },
    );
  }
  if (hostLookup === undefined || isIpAddress(host)) return;
  let addresses: WebsiteConnectorHostAddress[];
  try {
    addresses = await hostLookup(host);
  } catch {
    throw new ApiError(
      "connector_dns_lookup_failed",
      "Connector host DNS lookup failed.",
      502,
    );
  }
  if (addresses.length === 0)
    throw new ApiError(
      "connector_dns_lookup_failed",
      "Connector host DNS lookup failed.",
      502,
    );
  if (addresses.some((address) => isBlockedIpAddress(address.address))) {
    throw new ApiError(
      "connector_private_network_host_blocked",
      "Connector host resolves to a private or local network.",
      403,
      { host },
    );
  }
}

export function normalizeAllowedHosts(hosts: string[] | undefined): string[] {
  return [
    ...new Set(
      (hosts ?? [])
        .map((host) => host.trim().toLowerCase())
        .filter((host) => host.length > 0),
    ),
  ];
}

function hostMatchesRule(host: string, rule: string): boolean {
  if (rule.startsWith("*."))
    return host.endsWith(rule.slice(1)) && host !== rule.slice(2);
  return host === rule;
}

function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^\[(.*)\]$/u, "$1");
}

function isBlockedConnectorHost(host: string): boolean {
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  )
    return true;
  return isBlockedIpAddress(host);
}

function isIpAddress(value: string): boolean {
  return isIPv4(value) || value.includes(":");
}

function isBlockedIpAddress(value: string): boolean {
  if (isIPv4(value)) return isBlockedIPv4(value);
  if (value.includes(":")) return isBlockedIPv6(value);
  return false;
}

function isIPv4(value: string): boolean {
  return (
    /^(\d{1,3}\.){3}\d{1,3}$/u.test(value) &&
    value.split(".").every((part) => {
      const parsed = Number(part);
      return Number.isInteger(parsed) && parsed >= 0 && parsed <= 255;
    })
  );
}

function isBlockedIPv4(value: string): boolean {
  const [first = 0, second = 0] = value.split(".").map((part) => Number(part));
  if (first === 0 || first === 10 || first === 127 || first >= 224) return true;
  if (first === 100 && second >= 64 && second <= 127) return true;
  if (first === 169 && second === 254) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && (second === 0 || second === 168)) return true;
  if (first === 198 && (second === 18 || second === 19 || second === 51))
    return true;
  if (first === 203 && second === 0) return true;
  return false;
}

function isBlockedIPv6(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:192.168.")
  );
}

function readConnectorUrl(connector: DataConnector): URL {
  const value = connector.config.url;
  if (typeof value !== "string")
    throw new ApiError(
      "invalid_connector_config",
      "Website connector requires a URL.",
      400,
    );
  return new URL(value);
}

interface S3ConnectorConfig {
  bucket: string;
  maxItems: number;
  prefix: string;
  region: string;
  secretRef?: string;
}

function readS3Config(connector: DataConnector): S3ConnectorConfig {
  const bucket = connector.config.bucket;
  const prefix = connector.config.prefix;
  const region = connector.config.region;
  const maxItems = connector.config.maxItems;
  const secretRef = connector.config.secretRef;
  if (
    typeof bucket !== "string" ||
    typeof prefix !== "string" ||
    typeof region !== "string"
  ) {
    throw new ApiError(
      "invalid_connector_config",
      "S3 connector requires bucket, prefix, and region.",
      400,
    );
  }
  return {
    bucket,
    prefix,
    region,
    maxItems:
      typeof maxItems === "number" && Number.isInteger(maxItems)
        ? maxItems
        : 50,
    ...(typeof secretRef === "string" ? { secretRef } : {}),
  };
}

function normalizeTextMimeType(
  contentType: string | null,
  message: string,
): string {
  const mimeType =
    contentType?.split(";")[0]?.trim().toLowerCase() || "text/plain";
  if (
    mimeType === "text/html" ||
    mimeType === "text/plain" ||
    mimeType === "text/markdown" ||
    mimeType === "text/csv"
  )
    return mimeType;
  throw new ApiError("connector_response_unsupported", message, 415);
}

function normalizeFeedMimeType(
  contentType: string | null,
  message: string,
): string {
  const mimeType =
    contentType?.split(";")[0]?.trim().toLowerCase() || "application/rss+xml";
  if (
    mimeType === "application/rss+xml" ||
    mimeType === "application/atom+xml" ||
    mimeType === "application/xml" ||
    mimeType === "text/xml"
  )
    return mimeType;
  throw new ApiError("connector_response_unsupported", message, 415);
}

function mimeTypeFromKey(key: string): string {
  if (key.endsWith(".md") || key.endsWith(".markdown")) return "text/markdown";
  if (key.endsWith(".html") || key.endsWith(".htm")) return "text/html";
  if (key.endsWith(".csv")) return "text/csv";
  if (key.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
}

function websiteFileName(url: URL, mimeType: string): string {
  const rawName = url.pathname.split("/").filter(Boolean).at(-1) ?? "index";
  const safeBase =
    rawName.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80) || "index";
  if (safeBase.includes(".")) return safeBase;
  if (mimeType === "text/html") return `${safeBase}.html`;
  if (mimeType === "text/markdown") return `${safeBase}.md`;
  return `${safeBase}.txt`;
}

function s3FileName(key: string, prefix: string): string {
  const relative = key.slice(prefix.length).replace(/^\/+/u, "");
  const rawName =
    relative.split("/").filter(Boolean).join("__") ||
    key.split("/").filter(Boolean).at(-1) ||
    "object.txt";
  return rawName.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "object.txt";
}

function rssFileName(url: URL): string {
  const rawName = url.pathname.split("/").filter(Boolean).at(-1) ?? "feed";
  const safeBase =
    rawName.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80) || "feed";
  return `${safeBase}.md`;
}

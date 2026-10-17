import { ApiError } from "../errors";
import { dnsPinnedFetch, type DnsPinnedFetch } from "./dns-pinned-fetch";
import {
  assertConnectorHostAllowed,
  hostMatchesDomainRule,
  isRedirectResponse,
  normalizeAllowedHosts,
  normalizeHost,
  type WebsiteConnectorEgressPolicy,
  type WebsiteConnectorHostAddress,
  type WebsiteConnectorHostLookup,
} from "./outbound-network-policy";

/**
 * Governed single-page HTTP(S) fetch used by interactive URL attachments and
 * web retrieval. Every hop (including redirects) is checked against the
 * outbound network policy and pinned to the approved DNS answers.
 */
export class GovernedWebFetcher {
  private readonly fetchImpl: typeof fetch;
  private readonly maxBytes: number;
  private readonly timeoutMs: number;
  private readonly allowedHosts: string[];
  private readonly blockedHosts: string[];
  private readonly egressPolicy: WebsiteConnectorEgressPolicy;
  private readonly hostLookup: WebsiteConnectorHostLookup | undefined;
  private readonly pinnedFetchImpl: DnsPinnedFetch | undefined;
  private readonly retryPolicy: OutboundRetryPolicy;

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
        response = await retryOutboundResponse(request, this.retryPolicy);
        if (!isRedirectResponse(response)) break;
        const location = response.headers.get("location");
        if (location === null) break;
        if (redirectCount >= 5) {
          throw new ApiError(
            "connector_redirect_limit_exceeded",
            "Website fetch exceeded the redirect limit.",
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
        "Website fetch failed.",
        502,
        { status: response.status },
      );
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > this.maxBytes) {
      throw new ApiError(
        "connector_response_too_large",
        "Website response exceeds the configured size limit.",
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
        "Website response exceeds the configured size limit.",
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
          "user-agent": "RomeoWebFetch/0.1",
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
        "Website fetch failed.",
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
        "Host is blocked by the configured egress policy.",
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

function normalizeTextMimeType(
  contentType: string | null,
  message: string,
): string {
  const mimeType =
    contentType?.split(";")[0]?.trim().toLowerCase() || "text/plain";
  if (
    ["text/html", "text/plain", "text/markdown", "text/csv"].includes(mimeType)
  )
    return mimeType;
  throw new ApiError("connector_response_unsupported", message, 415);
}

interface OutboundRetryPolicy {
  retryAttempts: number;
  retryBackoffMs: number;
}

async function retryOutboundResponse(
  request: () => Promise<Response>,
  policy: OutboundRetryPolicy,
): Promise<Response> {
  let response = await request();
  for (let attempt = 0; attempt < policy.retryAttempts; attempt += 1) {
    if (!isRetryableResponse(response)) return response;
    await discardResponseBody(response);
    await sleep(retryDelayMs(response, policy.retryBackoffMs, attempt));
    response = await request();
  }
  return response;
}

function isRetryableResponse(response: Response): boolean {
  if ([429, 500, 502, 503, 504].includes(response.status)) return true;
  return (
    response.status === 403 &&
    response.headers.get("x-ratelimit-remaining") === "0"
  );
}

function retryDelayMs(
  response: Response,
  retryBackoffMs: number,
  attempt: number,
): number {
  const retryAfter = response.headers.get("retry-after");
  const retryAfterMs =
    retryAfter === null ? undefined : parseRetryAfterMs(retryAfter);
  if (retryAfterMs !== undefined) return Math.min(retryAfterMs, 30_000);
  return retryBackoffMs * Math.max(1, attempt + 1);
}

function parseRetryAfterMs(value: string): number | undefined {
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const dateMs = Date.parse(value);
  if (!Number.isFinite(dateMs)) return undefined;
  return Math.max(0, dateMs - Date.now());
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function discardResponseBody(response: Response): Promise<void> {
  if (response.body === null || response.bodyUsed) return;
  try {
    await response.body.cancel();
  } catch {
    // Best-effort cleanup only; the retry outcome should be driven by the next request.
  }
}

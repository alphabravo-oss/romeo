import {
  assertConnectorHostAllowed,
  isRedirectResponse,
  lookupNetworkHost,
  type WebsiteConnectorHostAddress,
  type WebsiteConnectorHostLookup,
} from "./data-connector-network-policy";
import { dnsPinnedFetch, type DnsPinnedFetch } from "./dns-pinned-fetch";
import { isPrivateNetworkHost } from "./network-host-policy";

const defaultMaxResponseBytes = 256 * 1024;
const defaultTimeoutMs = 10_000;
const maxAllowedResponseBytes = 32 * 1024 * 1024;
const maxAllowedTimeoutMs = 10 * 60_000;

export type SecretBearingEgressResponseMode = "buffered" | "streaming";

export interface SecretBearingEgressOptions {
  /** Exact HTTPS origins allowed for resource-server requests. */
  allowedOrigins?: readonly string[];
  /** Exact HTTPS URLs allowed for token and other fixed-endpoint requests. */
  allowedUrls?: readonly string[];
  /** Test-only raw transport. Production callers leave this unset. */
  fetchImpl?: typeof fetch;
  hostLookup?: WebsiteConnectorHostLookup;
  maxResponseBytes?: number;
  pinnedFetchImpl?: DnsPinnedFetch;
  /** Streaming preserves backpressure while enforcing the same byte/deadline bounds. */
  responseMode?: SecretBearingEgressResponseMode;
  timeoutMs?: number;
}

export class SecretBearingEgressError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "SecretBearingEgressError";
  }
}

/**
 * Fail-closed transport for requests carrying credentials or bearer tokens.
 * Production resolves every A/AAAA answer at the policy boundary, rejects the
 * entire answer set if any address is special/private, then pins the socket to
 * that approved set while preserving Host and TLS SNI. Credential redirects
 * are never followed, including redirects to another otherwise-approved URL.
 */
export class SecretBearingEgressClient {
  private readonly allowedOrigins: ReadonlySet<string>;
  private readonly allowedUrls: ReadonlySet<string>;
  private readonly fetchImpl: typeof fetch;
  private readonly hostLookup: WebsiteConnectorHostLookup | undefined;
  private readonly maxResponseBytes: number;
  private readonly pinnedFetchImpl: DnsPinnedFetch | undefined;
  private readonly responseMode: SecretBearingEgressResponseMode;
  private readonly timeoutMs: number;

  constructor(options: SecretBearingEgressOptions) {
    this.allowedOrigins = new Set(
      (options.allowedOrigins ?? []).map(normalizeAllowedOrigin),
    );
    this.allowedUrls = new Set(
      (options.allowedUrls ?? []).map(normalizeAllowedUrl),
    );
    if (this.allowedOrigins.size + this.allowedUrls.size === 0)
      throw new SecretBearingEgressError("secret_egress_allowlist_required");
    this.fetchImpl = options.fetchImpl ?? fetch;
    const usesProductionTransport =
      options.fetchImpl === undefined || options.fetchImpl === fetch;
    this.hostLookup =
      options.hostLookup ??
      (usesProductionTransport ? lookupNetworkHost : undefined);
    this.pinnedFetchImpl =
      options.pinnedFetchImpl ??
      (usesProductionTransport ? dnsPinnedFetch : undefined);
    this.maxResponseBytes = boundedInteger(
      options.maxResponseBytes,
      defaultMaxResponseBytes,
      maxAllowedResponseBytes,
    );
    this.responseMode = options.responseMode ?? "buffered";
    this.timeoutMs = boundedInteger(
      options.timeoutMs,
      defaultTimeoutMs,
      maxAllowedTimeoutMs,
    );
  }

  readonly fetch: typeof fetch = async (input, requestInit) => {
    const request = input instanceof Request ? input : undefined;
    const url = trustedHttpsUrl(
      request?.url ?? (input instanceof URL ? input.href : String(input)),
    );
    this.assertAllowed(url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const signals = [controller.signal];
    const callerSignal = requestInit?.signal ?? request?.signal;
    if (callerSignal != null) signals.push(callerSignal);
    const init: RequestInit = {
      ...(request === undefined
        ? {}
        : {
            body: request.body,
            headers: request.headers,
            method: request.method,
          }),
      ...requestInit,
      redirect: "manual",
      signal: AbortSignal.any(signals),
    };
    let streamOwnsTimeout = false;
    try {
      const addresses = await waitForAbort(
        this.approvedAddresses(url),
        init.signal!,
      );
      const response = await this.fetchOnce(url, init, addresses);
      if (isRedirectResponse(response)) {
        await response.body?.cancel().catch(() => undefined);
        throw new SecretBearingEgressError("secret_egress_redirect_blocked");
      }
      if (this.responseMode === "streaming" && response.body !== null) {
        streamOwnsTimeout = true;
        return this.boundStreaming(response, init.signal!, controller, timeout);
      }
      return await this.bound(response);
    } catch (error) {
      if (controller.signal.aborted)
        throw new SecretBearingEgressError("secret_egress_timeout");
      if (error instanceof SecretBearingEgressError) throw error;
      throw new SecretBearingEgressError("secret_egress_request_failed");
    } finally {
      if (!streamOwnsTimeout) clearTimeout(timeout);
    }
  };

  private assertAllowed(url: URL): void {
    if (isPrivateNetworkHost(url.hostname))
      throw new SecretBearingEgressError(
        "secret_egress_private_network_blocked",
      );
    if (
      !this.allowedUrls.has(url.toString()) &&
      !this.allowedOrigins.has(url.origin)
    )
      throw new SecretBearingEgressError("secret_egress_destination_blocked");
  }

  private async approvedAddresses(
    url: URL,
  ): Promise<WebsiteConnectorHostAddress[]> {
    try {
      return await assertConnectorHostAllowed(
        url,
        this.hostLookup === undefined ? {} : { hostLookup: this.hostLookup },
      );
    } catch {
      throw new SecretBearingEgressError("secret_egress_dns_denied");
    }
  }

  private async fetchOnce(
    url: URL,
    init: RequestInit,
    addresses: WebsiteConnectorHostAddress[],
  ): Promise<Response> {
    if (addresses.length > 0) {
      if (this.pinnedFetchImpl === undefined)
        throw new SecretBearingEgressError(
          "secret_egress_dns_pinning_unavailable",
        );
      return await this.pinnedFetchImpl(url, init, addresses);
    }
    return await this.fetchImpl(url, init);
  }

  private async bound(response: Response): Promise<Response> {
    const declaredLength = Number(response.headers.get("content-length"));
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > this.maxResponseBytes
    ) {
      await response.body?.cancel().catch(() => undefined);
      throw new SecretBearingEgressError("secret_egress_response_too_large");
    }
    if (response.body === null) return response;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > this.maxResponseBytes)
          throw new SecretBearingEgressError(
            "secret_egress_response_too_large",
          );
        chunks.push(value);
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    } finally {
      reader.releaseLock();
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new Response(body, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
  }

  private boundStreaming(
    response: Response,
    signal: AbortSignal,
    deadline: AbortController,
    timeout: ReturnType<typeof setTimeout>,
  ): Response {
    const declaredLength = Number(response.headers.get("content-length"));
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > this.maxResponseBytes
    ) {
      clearTimeout(timeout);
      void response.body?.cancel().catch(() => undefined);
      throw new SecretBearingEgressError("secret_egress_response_too_large");
    }
    const reader = response.body!.getReader();
    const maxResponseBytes = this.maxResponseBytes;
    let complete = false;
    let size = 0;
    const finish = () => {
      if (complete) return;
      complete = true;
      clearTimeout(timeout);
      reader.releaseLock();
    };
    const body = new ReadableStream<Uint8Array>({
      async pull(stream) {
        try {
          const result = await waitForAbort(reader.read(), signal);
          if (result.done) {
            finish();
            stream.close();
            return;
          }
          size += result.value.byteLength;
          if (size > maxResponseBytes) {
            await reader.cancel().catch(() => undefined);
            throw new SecretBearingEgressError(
              "secret_egress_response_too_large",
            );
          }
          stream.enqueue(result.value);
        } catch (error) {
          await reader.cancel().catch(() => undefined);
          finish();
          stream.error(
            deadline.signal.aborted
              ? new SecretBearingEgressError("secret_egress_timeout")
              : signal.aborted
                ? (signal.reason ?? error)
                : error instanceof SecretBearingEgressError
                  ? error
                  : new SecretBearingEgressError(
                      "secret_egress_request_failed",
                    ),
          );
        }
      },
      async cancel(reason) {
        await reader.cancel(reason).catch(() => undefined);
        finish();
      },
    });
    return new Response(body, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
  }
}

function trustedHttpsUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SecretBearingEgressError("secret_egress_url_invalid");
  }
  if (
    url.protocol !== "https:" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.hash.length > 0
  )
    throw new SecretBearingEgressError("secret_egress_url_invalid");
  return url;
}

function normalizeAllowedOrigin(value: string): string {
  const url = trustedHttpsUrl(value.trim());
  if (url.pathname !== "/" || url.search.length > 0)
    throw new SecretBearingEgressError("secret_egress_allowlist_invalid");
  return url.origin;
}

function normalizeAllowedUrl(value: string): string {
  const url = trustedHttpsUrl(value.trim());
  if (url.search.length > 0)
    throw new SecretBearingEgressError("secret_egress_allowlist_invalid");
  return url.toString();
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > maximum)
    throw new SecretBearingEgressError("secret_egress_limit_invalid");
  return value;
}

async function waitForAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) throw signal.reason;
  return await new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    void promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

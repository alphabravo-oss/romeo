import type { RomeoEnv } from "@romeo/config";

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
const maxAllowedResponseBytes = 1024 * 1024;
const maxAllowedTimeoutMs = 30_000;
const maxRedirects = 3;

export interface OidcEgressOptions {
  allowedEndpointOrigins?: string[];
  fetchImpl?: typeof fetch;
  hostLookup?: WebsiteConnectorHostLookup;
  maxResponseBytes?: number;
  pinnedFetchImpl?: DnsPinnedFetch;
  timeoutMs?: number;
}

export class OidcEgressError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "OidcEgressError";
  }
}

/**
 * Hardened, bounded transport for OIDC discovery and JWKS. Production requests
 * resolve once at the policy boundary and connect only to the approved result.
 * A raw transport can be injected for isolated tests without weakening the URL
 * and metadata checks that run before it.
 */
export class OidcEgressClient {
  readonly allowedEndpointOrigins: ReadonlySet<string>;
  private readonly fetchImpl: typeof fetch;
  private readonly hostLookup: WebsiteConnectorHostLookup | undefined;
  private readonly maxResponseBytes: number;
  private readonly pinnedFetchImpl: DnsPinnedFetch | undefined;
  private readonly timeoutMs: number;

  constructor(
    readonly issuer: string,
    options: OidcEgressOptions = {},
  ) {
    const issuerUrl = trustedHttpsUrl(issuer, "oidc_issuer_url_untrusted");
    if (issuerUrl.search.length > 0)
      throw new OidcEgressError("oidc_issuer_url_untrusted");
    this.allowedEndpointOrigins = new Set([
      issuerUrl.origin,
      ...normalizeAllowedOrigins(options.allowedEndpointOrigins),
    ]);
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
    this.timeoutMs = boundedInteger(
      options.timeoutMs,
      defaultTimeoutMs,
      maxAllowedTimeoutMs,
    );
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const request = input instanceof Request ? input : undefined;
    const initialUrl = new URL(
      request?.url ?? (input instanceof URL ? input.href : String(input)),
    );
    const mergedInit: RequestInit = {
      ...(request === undefined
        ? {}
        : {
            body: request.body,
            headers: request.headers,
            method: request.method,
            signal: request.signal,
          }),
      ...init,
    };
    return await this.fetchFollowingRedirects(initialUrl, mergedInit);
  };

  async fetchJson(url: string | URL): Promise<unknown> {
    const response = await this.fetch(url, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new OidcEgressError("oidc_fetch_http_failed");
    try {
      return await response.json();
    } catch {
      throw new OidcEgressError("oidc_json_invalid");
    }
  }

  assertMetadataEndpoint(value: string): void {
    this.assertUrlAllowed(new URL(value));
  }

  private async fetchFollowingRedirects(
    initialUrl: URL,
    initialInit: RequestInit,
  ): Promise<Response> {
    const carriesCredentials = requestCarriesCredentials(initialInit);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const signals = [controller.signal];
    if (initialInit.signal != null) signals.push(initialInit.signal);
    const signal = AbortSignal.any(signals);
    const init: RequestInit = {
      ...initialInit,
      redirect: "manual",
      signal,
    };
    let url = initialUrl;
    try {
      for (let redirectCount = 0; ; redirectCount += 1) {
        this.assertUrlAllowed(url);
        const addresses = await waitForAbort(
          this.approvedAddresses(url),
          signal,
        );
        const response = await this.fetchOnce(url, init, addresses);
        if (!isRedirectResponse(response)) return await this.bound(response);
        if (carriesCredentials) {
          await response.body?.cancel().catch(() => undefined);
          throw new OidcEgressError("oidc_credential_redirect_blocked");
        }
        const location = response.headers.get("location");
        if (location === null) return await this.bound(response);
        if (redirectCount >= maxRedirects)
          throw new OidcEgressError("oidc_redirect_limit_exceeded");
        await response.body?.cancel();
        url = new URL(location, url);
      }
    } catch (error) {
      if (controller.signal.aborted)
        throw new OidcEgressError("oidc_fetch_timeout");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private assertUrlAllowed(url: URL): void {
    trustedHttpsUrl(url.toString(), "oidc_metadata_url_untrusted");
    if (isPrivateNetworkHost(url.hostname))
      throw new OidcEgressError("oidc_private_network_host_blocked");
    if (!this.allowedEndpointOrigins.has(url.origin))
      throw new OidcEgressError("oidc_endpoint_origin_blocked");
  }

  private async approvedAddresses(
    url: URL,
  ): Promise<WebsiteConnectorHostAddress[]> {
    return await assertConnectorHostAllowed(
      url,
      this.hostLookup === undefined ? {} : { hostLookup: this.hostLookup },
    );
  }

  private async fetchOnce(
    url: URL,
    init: RequestInit,
    addresses: WebsiteConnectorHostAddress[],
  ): Promise<Response> {
    if (addresses.length > 0) {
      if (this.pinnedFetchImpl === undefined)
        throw new OidcEgressError("oidc_dns_pinning_unavailable");
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
      await response.body?.cancel();
      throw new OidcEgressError("oidc_response_too_large");
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
          throw new OidcEgressError("oidc_response_too_large");
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
}

function requestCarriesCredentials(init: RequestInit): boolean {
  if (init.body != null) return true;
  const headers = new Headers(init.headers);
  return ["authorization", "cookie", "proxy-authorization", "x-api-key"].some(
    (name) => headers.has(name),
  );
}

export function oidcEgressOptionsFromEnv(env: RomeoEnv): OidcEgressOptions {
  return {
    allowedEndpointOrigins: env.OIDC_ENDPOINT_ALLOWED_ORIGINS.split(",").filter(
      (value) => value.length > 0,
    ),
    maxResponseBytes: env.OIDC_FETCH_MAX_BYTES,
    timeoutMs: env.OIDC_FETCH_TIMEOUT_MS,
  };
}

function trustedHttpsUrl(value: string, code: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OidcEgressError(code);
  }
  if (
    url.protocol !== "https:" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.hash.length > 0
  ) {
    throw new OidcEgressError(code);
  }
  return url;
}

function normalizeAllowedOrigins(values: string[] | undefined): string[] {
  return [
    ...new Set(
      (values ?? []).map((value) => {
        const url = trustedHttpsUrl(
          value.trim(),
          "oidc_endpoint_allowlist_invalid",
        );
        if (
          url.pathname !== "/" ||
          url.search.length > 0 ||
          url.toString() !== url.origin + "/"
        ) {
          throw new OidcEgressError("oidc_endpoint_allowlist_invalid");
        }
        return url.origin;
      }),
    ),
  ];
}

function boundedInteger(
  value: number | undefined,
  defaultValue: number,
  maximum: number,
): number {
  if (value === undefined) return defaultValue;
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new TypeError("OIDC egress bounds must be positive integers.");
  return Math.min(value, maximum);
}

async function waitForAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) throw new DOMException("aborted", "AbortError");
  return await new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException("aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    void promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

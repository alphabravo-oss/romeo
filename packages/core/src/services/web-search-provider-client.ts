import type { QuotaCoordinator } from "./quota-coordination";
import type { SecretResolver } from "./secret-resolver";
import type { WebhookEmitter } from "./webhook-service";
import type { CapabilityService } from "./capability-resolver";
import { dnsPinnedFetch, type DnsPinnedFetch } from "./dns-pinned-fetch";
import {
  assertConnectorHostAllowed,
  type WebsiteConnectorHostLookup,
} from "./data-connector-executors";
import { withTelemetryFetch } from "./telemetry-context";
import { ApiError } from "../errors";
import {
  connectorDomainRules,
  domainMatches,
  isRedirectResponse,
  type StoredWebSearchConfiguration,
} from "./web-search-support";

export interface WebSearchServiceOptions {
  capabilities?: CapabilityService;
  fetchImpl?: typeof fetch;
  hostLookup?: WebsiteConnectorHostLookup;
  pinnedFetchImpl?: DnsPinnedFetch;
  quotaCoordinator?: QuotaCoordinator;
  secretResolver?: SecretResolver;
  timeoutMs?: number;
  webhooks?: WebhookEmitter;
}

export class WebSearchProviderClient {
  protected readonly fetchImpl: typeof fetch;
  protected readonly pinnedFetchImpl: DnsPinnedFetch | undefined;
  protected readonly timeoutMs: number;

  constructor(protected readonly options: WebSearchServiceOptions = {}) {
    this.fetchImpl = withTelemetryFetch(options.fetchImpl ?? fetch);
    this.pinnedFetchImpl =
      options.pinnedFetchImpl ??
      (options.fetchImpl === undefined ? dnsPinnedFetch : undefined);
    this.timeoutMs = options.timeoutMs ?? 12_000;
  }

  protected async fetchSearch(
    config: StoredWebSearchConfiguration,
    query: string,
    credential: string | undefined,
  ): Promise<unknown> {
    const endpoint = new URL(config.endpointUrl);
    let init: RequestInit;
    if (config.provider === "tavily") {
      init = {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(credential === undefined
            ? {}
            : { authorization: `Bearer ${credential}` }),
        },
        body: JSON.stringify({
          query,
          max_results: config.maxResults,
          include_answer: false,
        }),
      };
    } else {
      endpoint.searchParams.set("q", query);
      if (config.provider === "searxng")
        endpoint.searchParams.set("format", "json");
      if (config.provider === "brave")
        endpoint.searchParams.set("count", String(config.maxResults));
      init = {
        headers:
          credential === undefined
            ? {}
            : { "x-subscription-token": credential },
      };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchSearchFollowingRedirects(
        config,
        endpoint,
        { ...init, signal: controller.signal },
      );
      if (!response.ok)
        throw new ApiError(
          "web_search_provider_failed",
          `Web search provider returned HTTP ${response.status}.`,
          502,
          { status: response.status },
        );
      try {
        return await response.json();
      } catch {
        throw new ApiError(
          "web_search_invalid_response",
          "Web search provider returned invalid JSON.",
          502,
        );
      }
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ApiError(
          "web_search_provider_timeout",
          "Web search provider timed out.",
          504,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  protected async fetchSearchFollowingRedirects(
    config: StoredWebSearchConfiguration,
    initialUrl: URL,
    initialInit: RequestInit,
  ): Promise<Response> {
    let url = initialUrl;
    let init = initialInit;
    for (let redirectCount = 0; ; redirectCount += 1) {
      const approvedAddresses = await assertConnectorHostAllowed(url, {
        ...(config.allowedDomains.length === 0
          ? {}
          : { allowedHosts: connectorDomainRules(config.allowedDomains) }),
        egressPolicy:
          config.allowedDomains.length === 0
            ? "allow_public"
            : "require_allowlist",
        ...(this.options.hostLookup === undefined
          ? {}
          : { hostLookup: this.options.hostLookup }),
      });
      this.assertDomainNotBlocked(url.hostname, config);
      const requestInit = { ...init, redirect: "manual" as const };
      const response =
        this.pinnedFetchImpl === undefined || approvedAddresses.length === 0
          ? await this.fetchImpl(url, requestInit)
          : await this.pinnedFetchImpl(url, requestInit, approvedAddresses);
      if (!isRedirectResponse(response)) return response;
      const location = response.headers.get("location");
      if (location === null) return response;
      if (redirectCount >= 5) {
        throw new ApiError(
          "web_search_redirect_limit_exceeded",
          "Web search provider exceeded the redirect limit.",
          502,
        );
      }
      const redirected = new URL(location, url);
      if (redirected.protocol !== "https:" && redirected.protocol !== "http:") {
        throw new ApiError(
          "web_search_endpoint_invalid",
          "Web search endpoint must use HTTP or HTTPS.",
          400,
        );
      }
      const crossOrigin = redirected.origin !== url.origin;
      const statusSwitchesToGet =
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) &&
          init.method === "POST");
      const headers = new Headers(init.headers);
      if (crossOrigin) {
        headers.delete("authorization");
        headers.delete("x-subscription-token");
      }
      if (statusSwitchesToGet) headers.delete("content-type");
      if (statusSwitchesToGet) {
        const { body: _body, ...withoutBody } = init;
        init = { ...withoutBody, method: "GET", headers };
      } else {
        init = { ...init, headers };
      }
      url = redirected;
    }
  }

  protected isResultAllowed(
    urlValue: string,
    config: StoredWebSearchConfiguration,
  ): boolean {
    try {
      const host = new URL(urlValue).hostname.toLowerCase();
      if (config.blockedDomains.some((domain) => domainMatches(host, domain)))
        return false;
      return (
        config.allowedDomains.length === 0 ||
        config.allowedDomains.some((domain) => domainMatches(host, domain))
      );
    } catch {
      return false;
    }
  }

  protected assertDomainNotBlocked(
    host: string,
    config: StoredWebSearchConfiguration,
  ): void {
    if (
      config.blockedDomains.some((domain) =>
        domainMatches(host.toLowerCase(), domain),
      )
    ) {
      throw new ApiError(
        "web_domain_blocked",
        "The requested web domain is blocked by organization policy.",
        403,
        { host },
      );
    }
  }

  protected async resolveCredential(
    config: StoredWebSearchConfiguration,
  ): Promise<string | undefined> {
    if (config.credentialRef === undefined) return undefined;
    const resolution = await this.options.secretResolver?.resolveValue?.(
      config.credentialRef,
    );
    if (resolution?.value === undefined) {
      throw new ApiError(
        "web_search_credential_unavailable",
        "The web search credential could not be resolved.",
        409,
      );
    }
    return resolution.value;
  }
}

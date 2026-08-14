import { createHash } from "node:crypto";

import { assertScope, type AuthSubject } from "@romeo/auth";

import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { createId } from "../ids";
import { writeAuditLog } from "./audit-log";
import {
  authorizeWebRetrieval,
  enforceWebUrlLimit,
} from "./capability-consumer-enforcement";
import { consumeQuota } from "./consume-quota";
import {
  WebsiteDataConnectorExecutor,
  assertConnectorHostAllowed,
} from "./data-connector-executors";
import { assertManagedSecretRef } from "./secret-refs";
import { recordSubjectUsage } from "./record-usage";
import { recordRetrievalUnits } from "./web-search-usage";
import {
  configurationKey,
  connectorDomainRules,
  deduplicateSearchResults,
  extractPage,
  failureCode,
  healthKey,
  isFreshEnough,
  isUnreachableFailure,
  normalizeDomains,
  normalizeEndpoint,
  parseSearchResponse,
  publicConfiguration,
  type StoredWebSearchConfiguration,
  type WebSearchConfiguration,
  type WebSearchProvider,
  type WebSearchProviderHealth,
  type WebSearchResult,
} from "./web-search-support";
import { collectWebRetrievalHits } from "./web-retrieval-hits";
import { readStoredWebSearchConfiguration } from "./web-search-configuration-store";
import {
  WebSearchProviderClient,
  type WebSearchServiceOptions,
} from "./web-search-provider-client";

export * from "./web-search-support";

export class WebSearchService extends WebSearchProviderClient {
  constructor(
    private readonly repository: RomeoRepository,
    options: WebSearchServiceOptions = {},
  ) {
    super(options);
  }
  async configuration(subject: AuthSubject): Promise<WebSearchConfiguration> {
    assertScope(subject, "admin:read");
    return publicConfiguration(
      await readStoredWebSearchConfiguration(this.repository, subject.orgId),
      await this.readHealth(subject.orgId),
    );
  }

  async updateConfiguration(
    subject: AuthSubject,
    input: {
      enabled?: boolean;
      provider?: WebSearchProvider;
      endpointUrl?: string;
      credentialRef?: string | null;
      allowedDomains?: string[];
      blockedDomains?: string[];
      maxResults?: number;
      freshnessMaxAgeDays?: number | null;
      unknownPublicationDatePolicy?: "allow" | "exclude";
      unreachableUrlPolicy?: "fail" | "skip";
    },
  ): Promise<WebSearchConfiguration> {
    assertScope(subject, "admin:write");
    if (typeof input.credentialRef === "string")
      assertManagedSecretRef(input.credentialRef);
    const current = await readStoredWebSearchConfiguration(
      this.repository,
      subject.orgId,
    );
    const next: StoredWebSearchConfiguration = {
      ...current,
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      ...(input.provider === undefined ? {} : { provider: input.provider }),
      ...(input.endpointUrl === undefined
        ? {}
        : { endpointUrl: normalizeEndpoint(input.endpointUrl) }),
      ...(input.allowedDomains === undefined
        ? {}
        : { allowedDomains: normalizeDomains(input.allowedDomains) }),
      ...(input.blockedDomains === undefined
        ? {}
        : { blockedDomains: normalizeDomains(input.blockedDomains) }),
      ...(input.maxResults === undefined
        ? {}
        : { maxResults: Math.min(Math.max(input.maxResults, 1), 10) }),
      ...(input.freshnessMaxAgeDays === undefined
        ? {}
        : { freshnessMaxAgeDays: input.freshnessMaxAgeDays }),
      ...(input.unknownPublicationDatePolicy === undefined
        ? {}
        : { unknownPublicationDatePolicy: input.unknownPublicationDatePolicy }),
      ...(input.unreachableUrlPolicy === undefined
        ? {}
        : { unreachableUrlPolicy: input.unreachableUrlPolicy }),
      ...(input.credentialRef === null
        ? { credentialConfigured: false }
        : input.credentialRef === undefined
          ? {}
          : { credentialRef: input.credentialRef, credentialConfigured: true }),
    };
    if (input.credentialRef === null) delete next.credentialRef;
    const value: Record<string, unknown> = { ...next };
    if (next.credentialRef === undefined) delete value.credentialRef;
    await this.repository.upsertSystemSetting({
      key: configurationKey(subject.orgId),
      value,
      updatedAt: new Date().toISOString(),
    });
    await writeAuditLog(this.repository, {
      subject,
      action: "web_search.configuration.update",
      resourceType: "organization",
      resourceId: subject.orgId,
      metadata: {
        enabled: next.enabled,
        provider: next.provider,
        credentialConfigured: next.credentialConfigured,
        allowedDomainCount: next.allowedDomains.length,
        blockedDomainCount: next.blockedDomains.length,
      },
    });
    return publicConfiguration(next, await this.readHealth(subject.orgId));
  }

  async search(
    subject: AuthSubject,
    query: string,
    capabilityContext: WebCapabilityContext = {},
  ): Promise<WebSearchResult[]> {
    assertScope(subject, "runs:create");
    const normalizedQuery = query.trim();
    if (normalizedQuery.length === 0) return [];
    const config = await readStoredWebSearchConfiguration(
      this.repository,
      subject.orgId,
    );
    const capability = await authorizeWebRetrieval(
      this.options.capabilities,
      subject,
      { maxSearchResults: config.maxResults },
      capabilityContext,
    );
    if (!config.enabled) {
      throw new ApiError(
        "web_search_disabled",
        "Web search is disabled by the organization administrator.",
        409,
      );
    }
    const governedConfig = {
      ...config,
      maxResults: Math.min(config.maxResults, capability.maxSearchResults),
    };
    await this.repository.transaction((repository) =>
      consumeQuota(
        repository,
        subject,
        { metric: "web.search.request", quantity: 1 },
        {
          quotaCoordinator: this.options.quotaCoordinator,
          webhooks: this.options.webhooks,
        },
      ),
    );
    const sourceId = createId("web_search");
    const endpoint = new URL(governedConfig.endpointUrl);
    await assertConnectorHostAllowed(endpoint, {
      ...(governedConfig.allowedDomains.length === 0
        ? {}
        : {
            allowedHosts: connectorDomainRules(governedConfig.allowedDomains),
          }),
      egressPolicy:
        governedConfig.allowedDomains.length === 0
          ? "allow_public"
          : "require_allowlist",
      ...(this.options.hostLookup === undefined
        ? {}
        : { hostLookup: this.options.hostLookup }),
    });
    this.assertDomainNotBlocked(endpoint.hostname, governedConfig);
    const credential = await this.resolveCredential(governedConfig);
    const startedAt = Date.now();
    let response: unknown;
    try {
      response = await this.fetchSearch(
        governedConfig,
        normalizedQuery,
        credential,
      );
      await this.writeHealth(subject.orgId, {
        status: "healthy",
        lastCheckedAt: new Date().toISOString(),
        latencyMs: Math.max(0, Date.now() - startedAt),
      });
    } catch (error) {
      await this.writeHealth(subject.orgId, {
        status: "degraded",
        lastCheckedAt: new Date().toISOString(),
        latencyMs: Math.max(0, Date.now() - startedAt),
        lastErrorCode:
          error instanceof ApiError
            ? error.code
            : "web_search_provider_unreachable",
      });
      await recordSubjectUsage(this.repository, subject, {
        orgId: subject.orgId,
        sourceType: "retrieval",
        sourceId,
        metric: "web.search.request",
        quantity: 1,
        unit: "request",
        metadata: {
          provider: config.provider,
          outcome: "failure",
          latencyMs: Math.max(0, Date.now() - startedAt),
          errorCode:
            error instanceof ApiError
              ? error.code
              : "web_search_provider_unreachable",
        },
      });
      throw error;
    }
    const parsed = parseSearchResponse(
      governedConfig.provider,
      response,
      governedConfig.maxResults,
    ).filter((result) => this.isResultAllowed(result.url, governedConfig));
    const freshResults = parsed.filter((result) =>
      isFreshEnough(result, governedConfig),
    );
    const results = deduplicateSearchResults(freshResults);
    await writeAuditLog(this.repository, {
      subject,
      action: "web_search.query",
      resourceType: "organization",
      resourceId: subject.orgId,
      metadata: {
        provider: governedConfig.provider,
        queryHash: createHash("sha256").update(normalizedQuery).digest("hex"),
        resultCount: results.length,
        freshnessExcludedCount: parsed.length - freshResults.length,
      },
    });
    await recordSubjectUsage(this.repository, subject, {
      orgId: subject.orgId,
      sourceType: "retrieval",
      sourceId,
      metric: "web.search.request",
      quantity: 1,
      unit: "request",
      metadata: {
        provider: governedConfig.provider,
        outcome: "success",
        latencyMs: Math.max(0, Date.now() - startedAt),
        resultCount: results.length,
      },
    });
    await recordRetrievalUnits(this.repository, subject, {
      sourceId,
      quantity: results.length,
      operation: "search_result",
      provider: governedConfig.provider,
    });
    return results;
  }

  async ingestUrls(
    subject: AuthSubject,
    urls: string[],
    capabilityContext: WebCapabilityContext = {},
  ): Promise<Array<WebSearchResult & { content: string }>> {
    assertScope(subject, "runs:create");
    if (urls.length > 5)
      throw new ApiError(
        "web_url_limit_exceeded",
        "A request can include up to five URLs.",
        400,
      );
    const config = await readStoredWebSearchConfiguration(
      this.repository,
      subject.orgId,
    );
    const capability = await authorizeWebRetrieval(
      this.options.capabilities,
      subject,
      { maxUrlsPerRequest: urls.length },
      capabilityContext,
    );
    enforceWebUrlLimit(urls.length, capability.maxUrlsPerRequest);
    if (!config.enabled)
      throw new ApiError(
        "web_search_disabled",
        "Web access is disabled by the organization administrator.",
        409,
      );
    await this.repository.transaction((repository) =>
      consumeQuota(
        repository,
        subject,
        { metric: "web.url.fetch", quantity: urls.length },
        {
          quotaCoordinator: this.options.quotaCoordinator,
          webhooks: this.options.webhooks,
        },
      ),
    );
    const sourceId = createId("web_ingest");
    const startedAt = Date.now();
    const executor = new WebsiteDataConnectorExecutor({
      fetchImpl: this.fetchImpl,
      ...(this.pinnedFetchImpl === undefined
        ? {}
        : { pinnedFetchImpl: this.pinnedFetchImpl }),
      allowedHosts: connectorDomainRules(config.allowedDomains),
      blockedHosts: config.blockedDomains,
      egressPolicy:
        config.allowedDomains.length === 0
          ? "allow_public"
          : "require_allowlist",
      ...(this.options.hostLookup === undefined
        ? {}
        : { hostLookup: this.options.hostLookup }),
      maxBytes: 1_000_000,
      timeoutMs: 12_000,
    });
    const settled = await Promise.allSettled(
      urls.map(async (value) => {
        const url = new URL(value);
        this.assertDomainNotBlocked(url.hostname, config);
        const fetched = await executor.fetchUrl(url.toString());
        const finalUrl = new URL(fetched.finalUrl);
        const extracted = extractPage(
          fetched.content,
          fetched.mimeType,
          finalUrl,
        );
        return {
          id: createId("web"),
          title: extracted.title,
          url: finalUrl.toString(),
          snippet: extracted.content.slice(0, 500),
          content: extracted.content.slice(0, 30_000),
          accessedAt: new Date().toISOString(),
          sourceType: "url" as const,
        };
      }),
    );
    const failures = settled.filter(
      (item): item is PromiseRejectedResult => item.status === "rejected",
    );
    const policyFailure = failures.find(
      (item) => !isUnreachableFailure(item.reason),
    );
    const items = settled.flatMap((item) =>
      item.status === "fulfilled" ? [item.value] : [],
    );
    if (
      policyFailure !== undefined ||
      (config.unreachableUrlPolicy === "fail" && failures[0] !== undefined)
    ) {
      await recordSubjectUsage(this.repository, subject, {
        orgId: subject.orgId,
        sourceType: "retrieval",
        sourceId,
        metric: "web.url.fetch",
        quantity: urls.length,
        unit: "url",
        metadata: {
          outcome: "failure",
          succeededCount: items.length,
          unreachableCount: failures.filter((item) =>
            isUnreachableFailure(item.reason),
          ).length,
          errorCode: failureCode(policyFailure?.reason ?? failures[0]?.reason),
          latencyMs: Math.max(0, Date.now() - startedAt),
        },
      });
      throw policyFailure?.reason ?? failures[0]!.reason;
    }
    await writeAuditLog(this.repository, {
      subject,
      action: "web_url.ingest",
      resourceType: "organization",
      resourceId: subject.orgId,
      metadata: {
        requestedUrlCount: urls.length,
        urlCount: items.length,
        unreachableCount: failures.length,
        unreachablePolicy: config.unreachableUrlPolicy,
        hosts: [...new Set(items.map((item) => new URL(item.url).hostname))],
      },
    });
    await recordSubjectUsage(this.repository, subject, {
      orgId: subject.orgId,
      sourceType: "retrieval",
      sourceId,
      metric: "web.url.fetch",
      quantity: urls.length,
      unit: "url",
      metadata: {
        outcome: failures.length === 0 ? "success" : "partial",
        succeededCount: items.length,
        unreachableCount: failures.length,
        latencyMs: Math.max(0, Date.now() - startedAt),
      },
    });
    await recordRetrievalUnits(this.repository, subject, {
      sourceId,
      quantity: items.length,
      operation: "url_content",
    });
    return items;
  }

  retrievalHits(
    subject: AuthSubject,
    input: {
      query: string;
      search: boolean;
      urls: string[];
      workspaceId: string;
      agentId: string;
      agentVersionId: string;
    },
  ) {
    return collectWebRetrievalHits(subject, input, {
      search: (currentSubject, query) =>
        this.search(currentSubject, query, input),
      ingest: (currentSubject, urls) =>
        this.ingestUrls(currentSubject, urls, input),
    });
  }

  private async readHealth(orgId: string): Promise<WebSearchProviderHealth> {
    const value =
      (await this.repository.getSystemSetting(healthKey(orgId)))?.value ?? {};
    const status =
      value.status === "healthy" || value.status === "degraded"
        ? value.status
        : "unknown";
    return {
      status,
      ...(typeof value.lastCheckedAt === "string"
        ? { lastCheckedAt: value.lastCheckedAt }
        : {}),
      ...(typeof value.latencyMs === "number"
        ? { latencyMs: value.latencyMs }
        : {}),
      ...(typeof value.lastErrorCode === "string"
        ? { lastErrorCode: value.lastErrorCode }
        : {}),
    };
  }

  private async writeHealth(
    orgId: string,
    health: WebSearchProviderHealth,
  ): Promise<void> {
    await this.repository.upsertSystemSetting({
      key: healthKey(orgId),
      value: { ...health },
      updatedAt: new Date().toISOString(),
    });
  }
}

type WebCapabilityContext = {
  workspaceId?: string;
  agentId?: string;
  agentVersionId?: string;
};

import type { RetrievalHit } from "@romeo/rag";

import { ApiError } from "../errors";
import { createId } from "../ids";

export type WebSearchProvider = "brave" | "searxng" | "tavily";

export interface WebSearchConfiguration {
  enabled: boolean;
  provider: WebSearchProvider;
  endpointUrl: string;
  credentialConfigured: boolean;
  allowedDomains: string[];
  blockedDomains: string[];
  maxResults: number;
  freshnessMaxAgeDays: number | null;
  unknownPublicationDatePolicy: "allow" | "exclude";
  unreachableUrlPolicy: "fail" | "skip";
  health: WebSearchProviderHealth;
}

export interface WebSearchProviderHealth {
  status: "unknown" | "healthy" | "degraded";
  lastCheckedAt?: string;
  latencyMs?: number;
  lastErrorCode?: string;
}

export interface StoredWebSearchConfiguration extends Omit<
  WebSearchConfiguration,
  "health"
> {
  orgId: string;
  credentialRef?: string;
}

export interface WebSearchResult {
  id: string;
  title: string;
  url: string;
  snippet: string;
  accessedAt: string;
  publishedAt?: string;
  sourceType: "url" | "web_search";
  provider?: WebSearchProvider;
}

export function configurationKey(orgId: string): string {
  return `web_search.org.v1:${orgId}`;
}
export function healthKey(orgId: string): string {
  return `web_search.health.v1:${orgId}`;
}

export function publicConfiguration(
  config: StoredWebSearchConfiguration,
  health: WebSearchProviderHealth,
): WebSearchConfiguration {
  return {
    enabled: config.enabled,
    provider: config.provider,
    endpointUrl: config.endpointUrl,
    credentialConfigured: config.credentialConfigured,
    allowedDomains: config.allowedDomains,
    blockedDomains: config.blockedDomains,
    maxResults: config.maxResults,
    freshnessMaxAgeDays: config.freshnessMaxAgeDays,
    unknownPublicationDatePolicy: config.unknownPublicationDatePolicy,
    unreachableUrlPolicy: config.unreachableUrlPolicy,
    health,
  };
}

export function normalizeEndpoint(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new ApiError(
      "web_search_endpoint_invalid",
      "Web search endpoint must use HTTP or HTTPS.",
      400,
    );
  url.username = "";
  url.password = "";
  return url.toString();
}

export function normalizeDomains(values: string[]): string[] {
  return [
    ...new Set(
      values
        .map((value) => value.trim().toLowerCase().replace(/^\*\./u, ""))
        .filter(Boolean),
    ),
  ].slice(0, 100);
}

export function connectorDomainRules(domains: string[]): string[] {
  return domains.flatMap((domain) => [domain, `*.${domain}`]);
}

export function domainMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export function isRedirectResponse(response: Response): boolean {
  return (
    response.status === 301 ||
    response.status === 302 ||
    response.status === 303 ||
    response.status === 307 ||
    response.status === 308
  );
}

export function parseSearchResponse(
  provider: WebSearchProvider,
  value: unknown,
  maxResults: number,
): WebSearchResult[] {
  const record = asRecord(value);
  const raw =
    provider === "brave" ? asRecord(record.web).results : record.results;
  if (!Array.isArray(raw)) return [];
  return raw
    .flatMap((item, index) => {
      const result = asRecord(item);
      const url = stringValue(result.url);
      if (url === undefined) return [];
      return [
        {
          id: createId("web"),
          title: stringValue(result.title) ?? new URL(url).hostname,
          url,
          snippet: stripHtml(
            stringValue(result.description) ??
              stringValue(result.content) ??
              stringValue(result.snippet) ??
              "",
          ).slice(0, 1_500),
          accessedAt: new Date().toISOString(),
          ...publishedAtOf(result),
          sourceType: "web_search" as const,
          provider,
          rank: index,
        },
      ];
    })
    .slice(0, maxResults)
    .map(({ rank: _rank, ...result }) => result);
}

function publishedAtOf(result: Record<string, unknown>): {
  publishedAt?: string;
} {
  const value =
    stringValue(result.publishedAt) ??
    stringValue(result.published_at) ??
    stringValue(result.publishedDate) ??
    stringValue(result.published_date) ??
    stringValue(result.date);
  if (value === undefined) return {};
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? { publishedAt: new Date(timestamp).toISOString() }
    : {};
}

export function isFreshEnough(
  result: WebSearchResult,
  config: StoredWebSearchConfiguration,
): boolean {
  if (config.freshnessMaxAgeDays === null) return true;
  if (result.publishedAt === undefined)
    return config.unknownPublicationDatePolicy === "allow";
  return (
    Date.parse(result.publishedAt) >=
    Date.now() - config.freshnessMaxAgeDays * 86_400_000
  );
}

export function isUnreachableFailure(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status >= 500;
}

export function failureCode(error: unknown): string {
  return error instanceof ApiError ? error.code : "web_url_unreachable";
}

export function deduplicateSearchResults(
  results: WebSearchResult[],
): WebSearchResult[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    const url = new URL(result.url);
    url.hash = "";
    const key = url.toString();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function resultToHit(
  result: WebSearchResult,
  content: string,
  score: number,
): RetrievalHit {
  return {
    id: result.id,
    content,
    score,
    citation: {
      documentId: result.id,
      chunkId: result.id,
      title: result.title,
      sourceUri: result.url,
    },
    metadata: {
      sourceType: result.sourceType,
      retrievedAt: result.accessedAt,
      accessedAt: result.accessedAt,
      ...(result.provider === undefined ? {} : { provider: result.provider }),
      ...(result.publishedAt === undefined
        ? {}
        : { publishedAt: result.publishedAt }),
      sourceUri: result.url,
      snippet: result.snippet,
    },
  };
}

export function extractPage(
  content: string,
  mimeType: string,
  url: URL,
): { title: string; content: string } {
  if (mimeType !== "text/html")
    return { title: url.hostname, content: content.trim() };
  const title =
    stripHtml(/<title\b[^>]*>([\s\S]*?)<\/title>/iu.exec(content)?.[1] ?? "") ||
    url.hostname;
  const text = stripHtml(
    content
      .replace(/<script\b[\s\S]*?<\/script>/giu, " ")
      .replace(/<style\b[\s\S]*?<\/style>/giu, " "),
  );
  return { title, content: text };
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/gu, " ")
    .replace(/&nbsp;/giu, " ")
    .replace(/&amp;/giu, "&")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">")
    .replace(/\s+/gu, " ")
    .trim();
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

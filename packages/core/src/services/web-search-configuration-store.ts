import type { RomeoRepository } from "../domain/repository";
import {
  configurationKey,
  healthKey,
  normalizeDomains,
  normalizeEndpoint,
  type StoredWebSearchConfiguration,
  type WebSearchProviderHealth,
} from "./web-search-support";

export async function readWebSearchProviderHealth(
  repository: RomeoRepository,
  orgId: string,
): Promise<WebSearchProviderHealth> {
  const value =
    (await repository.getSystemSetting(healthKey(orgId), orgId))?.value ?? {};
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

export async function writeWebSearchProviderHealth(
  repository: RomeoRepository,
  orgId: string,
  health: WebSearchProviderHealth,
): Promise<void> {
  await repository.upsertSystemSetting(
    {
      key: healthKey(orgId),
      value: { ...health },
      updatedAt: new Date().toISOString(),
    },
    orgId,
  );
}

export async function readStoredWebSearchConfiguration(
  repository: RomeoRepository,
  orgId: string,
): Promise<StoredWebSearchConfiguration> {
  const value =
    (await repository.getSystemSetting(configurationKey(orgId), orgId))
      ?.value ?? {};
  return {
    orgId,
    enabled: value.enabled === true,
    provider:
      value.provider === "brave" || value.provider === "tavily"
        ? value.provider
        : "searxng",
    endpointUrl:
      typeof value.endpointUrl === "string"
        ? normalizeEndpoint(value.endpointUrl)
        : "https://search.example.invalid",
    credentialConfigured:
      typeof value.credentialRef === "string" && value.credentialRef.length > 0,
    ...(typeof value.credentialRef === "string"
      ? { credentialRef: value.credentialRef }
      : {}),
    allowedDomains: normalizeDomains(
      Array.isArray(value.allowedDomains)
        ? value.allowedDomains.filter(
            (item): item is string => typeof item === "string",
          )
        : [],
    ),
    blockedDomains: normalizeDomains(
      Array.isArray(value.blockedDomains)
        ? value.blockedDomains.filter(
            (item): item is string => typeof item === "string",
          )
        : [],
    ),
    maxResults:
      typeof value.maxResults === "number"
        ? Math.min(Math.max(Math.trunc(value.maxResults), 1), 10)
        : 5,
    freshnessMaxAgeDays:
      typeof value.freshnessMaxAgeDays === "number"
        ? Math.min(Math.max(Math.trunc(value.freshnessMaxAgeDays), 1), 3650)
        : null,
    unknownPublicationDatePolicy:
      value.unknownPublicationDatePolicy === "exclude" ? "exclude" : "allow",
    unreachableUrlPolicy:
      value.unreachableUrlPolicy === "skip" ? "skip" : "fail",
  };
}

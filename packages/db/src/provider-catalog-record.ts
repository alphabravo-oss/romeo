import type {
  ProviderCatalogSyncState,
  ProviderCatalogSyncStatus,
} from "@romeo/providers";

export function asProviderCatalogSyncState(
  value: unknown,
): ProviderCatalogSyncState | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const input = value as Record<string, unknown>;
  const allowedStatuses = new Set<ProviderCatalogSyncStatus>([
    "error",
    "never",
    "ready",
    "stale",
    "syncing",
  ]);
  if (
    !allowedStatuses.has(input.status as ProviderCatalogSyncStatus) ||
    typeof input.modelCount !== "number" ||
    !Number.isInteger(input.modelCount) ||
    input.modelCount < 0
  ) {
    return undefined;
  }
  return {
    status: input.status as ProviderCatalogSyncStatus,
    modelCount: input.modelCount,
    ...(typeof input.lastAttemptAt === "string"
      ? { lastAttemptAt: input.lastAttemptAt }
      : {}),
    ...(typeof input.lastSyncedAt === "string"
      ? { lastSyncedAt: input.lastSyncedAt }
      : {}),
    ...(typeof input.error === "string" ? { error: input.error } : {}),
  };
}

export const PROVIDER_CATALOG_INLINE_CEILING = 500;
export const PROVIDER_CATALOG_SYNC_JOB_SCHEMA =
  "romeo.provider-catalog-sync-job.v1";

export type ProviderCatalogSyncMode = "async_job" | "inline";

export function authorizeProviderCatalogSync(input: {
  estimatedModels: number;
  mode: ProviderCatalogSyncMode;
}):
  | { mode: "async_job"; outcome: "accepted" }
  | { mode: "inline"; outcome: "accepted" }
  | { code: "provider_catalog_sync_must_be_async"; outcome: "denied" } {
  if (
    input.mode === "inline" &&
    input.estimatedModels > PROVIDER_CATALOG_INLINE_CEILING
  ) {
    return { code: "provider_catalog_sync_must_be_async", outcome: "denied" };
  }
  return { mode: input.mode, outcome: "accepted" };
}

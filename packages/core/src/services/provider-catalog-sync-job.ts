export const PROVIDER_CATALOG_INLINE_CEILING = 500;
export const PROVIDER_CATALOG_SYNC_JOB_SCHEMA =
  "romeo.provider-catalog-sync-job.v1";

export type ProviderCatalogSyncMode = "async_job" | "inline";
export type ProviderCatalogSyncJobState =
  | "failed"
  | "queued"
  | "ready"
  | "running";

export interface ProviderCatalogSyncJob {
  createdAt: string;
  error?: string;
  id: string;
  modelCount: number;
  orgId: string;
  percent: number;
  providerId: string;
  schema: typeof PROVIDER_CATALOG_SYNC_JOB_SCHEMA;
  state: ProviderCatalogSyncJobState;
  updatedAt: string;
}

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

export function advanceProviderCatalogSyncJob(input: {
  job: ProviderCatalogSyncJob;
  modelCount?: number;
  now: string;
  outcome: "failed" | "ready" | "started";
  error?: string;
}): ProviderCatalogSyncJob {
  if (input.outcome === "started") {
    return {
      ...input.job,
      percent: 10,
      state: "running",
      updatedAt: input.now,
    };
  }
  if (input.outcome === "failed") {
    return {
      ...input.job,
      percent: 100,
      state: "failed",
      updatedAt: input.now,
      ...(input.error === undefined ? {} : { error: input.error.slice(0, 300) }),
    };
  }
  return {
    ...input.job,
    modelCount: input.modelCount ?? input.job.modelCount,
    percent: 100,
    state: "ready",
    updatedAt: input.now,
  };
}

export function publicProviderCatalogSyncJob(job: ProviderCatalogSyncJob) {
  return {
    jobId: job.id,
    modelCount: job.modelCount,
    percent: job.percent,
    providerId: job.providerId,
    state: job.state,
    ...(job.error === undefined ? {} : { error: job.error }),
  };
}

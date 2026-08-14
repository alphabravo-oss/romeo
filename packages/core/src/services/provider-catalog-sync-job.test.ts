import { describe, expect, it } from "vitest";

import {
  PROVIDER_CATALOG_INLINE_CEILING,
  advanceProviderCatalogSyncJob,
  authorizeProviderCatalogSync,
  publicProviderCatalogSyncJob,
  type ProviderCatalogSyncJob,
} from "./provider-catalog-sync-job";

const job: ProviderCatalogSyncJob = {
  createdAt: "2026-08-14T00:00:00.000Z",
  id: "sync_job_1",
  modelCount: 0,
  orgId: "org_default",
  percent: 0,
  providerId: "provider_1",
  schema: "romeo.provider-catalog-sync-job.v1",
  state: "queued",
  updatedAt: "2026-08-14T00:00:00.000Z",
};

describe("provider catalog sync job", () => {
  it("forces large catalogs onto the observable async job", () => {
    expect(
      authorizeProviderCatalogSync({
        estimatedModels: PROVIDER_CATALOG_INLINE_CEILING + 1,
        mode: "inline",
      }),
    ).toEqual({
      code: "provider_catalog_sync_must_be_async",
      outcome: "denied",
    });
    expect(
      authorizeProviderCatalogSync({
        estimatedModels: PROVIDER_CATALOG_INLINE_CEILING + 1,
        mode: "async_job",
      }),
    ).toEqual({ mode: "async_job", outcome: "accepted" });
  });

  it("advances queued → running → ready without leaking secrets", () => {
    const running = advanceProviderCatalogSyncJob({
      job,
      now: "2026-08-14T00:01:00.000Z",
      outcome: "started",
    });
    expect(running.state).toBe("running");
    const ready = advanceProviderCatalogSyncJob({
      job: running,
      modelCount: 12,
      now: "2026-08-14T00:02:00.000Z",
      outcome: "ready",
    });
    expect(publicProviderCatalogSyncJob(ready)).toEqual({
      jobId: "sync_job_1",
      modelCount: 12,
      percent: 100,
      providerId: "provider_1",
      state: "ready",
    });
    expect(JSON.stringify(ready)).not.toMatch(/sk-|hashedToken|apiKey/u);
  });
});

import type { AuthSubject } from "@romeo/auth";
import { assertScope, canAccessOrg } from "@romeo/auth";

import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import {
  PROVIDER_CATALOG_SYNC_JOB_SCHEMA,
  advanceProviderCatalogSyncJob,
  authorizeProviderCatalogSync,
  publicProviderCatalogSyncJob,
  type ProviderCatalogSyncJob,
  type ProviderCatalogSyncMode,
} from "./provider-catalog-sync-job";

export class ProviderCatalogSyncJobStore {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly sync: (
      subject: AuthSubject,
      providerId: string,
    ) => Promise<{ length: number }>,
  ) {}

  async start(input: {
    mode: ProviderCatalogSyncMode;
    providerId: string;
    subject: AuthSubject;
  }) {
    assertScope(input.subject, "providers:write");
    const provider = await this.repository.getProvider(input.providerId);
    if (provider === undefined || !canAccessOrg(input.subject, provider.orgId))
      throw notFound("Provider");
    const authorized = authorizeProviderCatalogSync({
      estimatedModels: provider.catalogSync?.modelCount ?? 0,
      mode: input.mode,
    });
    if (authorized.outcome === "denied") {
      throw new ApiError(
        "invalid_request",
        "Large provider catalogs must sync through an observable job.",
        400,
        { code: authorized.code },
      );
    }
    if (authorized.mode === "inline") return { mode: "inline" as const };
    const existing = await this.findActive(provider.id, input.subject.orgId);
    if (existing !== undefined)
      return {
        job: publicProviderCatalogSyncJob(existing),
        mode: "async_job" as const,
      };
    const now = new Date().toISOString();
    const job: ProviderCatalogSyncJob = {
      createdAt: now,
      id: createId("sync_job"),
      modelCount: provider.catalogSync?.modelCount ?? 0,
      orgId: input.subject.orgId,
      percent: 0,
      providerId: provider.id,
      schema: PROVIDER_CATALOG_SYNC_JOB_SCHEMA,
      state: "queued",
      updatedAt: now,
    };
    await this.save(job);
    return { job: publicProviderCatalogSyncJob(job), mode: "async_job" as const };
  }

  async run(input: { jobId: string; subject: AuthSubject }) {
    const job = await this.read(input.subject, input.jobId);
    const started = advanceProviderCatalogSyncJob({
      job,
      now: new Date().toISOString(),
      outcome: "started",
    });
    await this.save(started);
    try {
      const models = await this.sync(input.subject, job.providerId);
      const ready = advanceProviderCatalogSyncJob({
        job: started,
        modelCount: models.length,
        now: new Date().toISOString(),
        outcome: "ready",
      });
      await this.save(ready);
      return publicProviderCatalogSyncJob(ready);
    } catch (caught) {
      const failed = advanceProviderCatalogSyncJob({
        error:
          caught instanceof Error
            ? caught.message
            : "Provider catalog sync failed.",
        job: started,
        now: new Date().toISOString(),
        outcome: "failed",
      });
      await this.save(failed);
      return publicProviderCatalogSyncJob(failed);
    }
  }

  async get(input: { jobId: string; subject: AuthSubject }) {
    return publicProviderCatalogSyncJob(
      await this.read(input.subject, input.jobId),
    );
  }

  private async findActive(providerId: string, orgId: string) {
    for (const setting of await this.repository.listSystemSettings()) {
      if (!setting.key.startsWith("provider.catalog-sync-job.v1:")) continue;
      const value = setting.value;
      if (value === null || typeof value !== "object" || Array.isArray(value))
        continue;
      const job = value as ProviderCatalogSyncJob;
      if (
        job.schema === PROVIDER_CATALOG_SYNC_JOB_SCHEMA &&
        job.orgId === orgId &&
        job.providerId === providerId &&
        (job.state === "queued" || job.state === "running")
      )
        return job;
    }
    return undefined;
  }

  private async read(subject: AuthSubject, jobId: string) {
    assertScope(subject, "providers:write");
    const value = (await this.repository.getSystemSetting(storeKey(jobId)))
      ?.value;
    if (value === null || typeof value !== "object" || Array.isArray(value))
      throw notFound("Catalog sync job");
    const job = value as ProviderCatalogSyncJob;
    if (
      job.schema !== PROVIDER_CATALOG_SYNC_JOB_SCHEMA ||
      job.orgId !== subject.orgId
    )
      throw notFound("Catalog sync job");
    return job;
  }

  private save(job: ProviderCatalogSyncJob) {
    return this.repository.upsertSystemSetting({
      key: storeKey(job.id),
      updatedAt: job.updatedAt,
      value: job,
    });
  }
}

function storeKey(jobId: string): string {
  return `provider.catalog-sync-job.v1:${jobId}`;
}

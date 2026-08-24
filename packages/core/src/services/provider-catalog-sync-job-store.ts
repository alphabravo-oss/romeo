import type { AuthSubject } from "@romeo/auth";
import { assertScope, canAccessOrg } from "@romeo/auth";

import type { BackgroundJob } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import {
  PROVIDER_CATALOG_SYNC_JOB_SCHEMA,
  authorizeProviderCatalogSync,
  type ProviderCatalogSyncMode,
} from "./provider-catalog-sync-job";

const JOB_TYPE = "provider_catalog_sync";
const LEASE_SECONDS = 60;

interface CatalogSyncPayload {
  modelCount: number;
  percent: number;
  providerId: string;
  schema: typeof PROVIDER_CATALOG_SYNC_JOB_SCHEMA;
  state: "failed" | "queued" | "ready" | "running";
  error?: string;
}

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
      return { job: publicJob(existing), mode: "async_job" as const };
    const now = new Date().toISOString();
    const job: BackgroundJob = {
      createdAt: now,
      id: createId("sync_job"),
      orgId: input.subject.orgId,
      payload: catalogSyncPayload({
        modelCount: provider.catalogSync?.modelCount ?? 0,
        percent: 0,
        providerId: provider.id,
        schema: PROVIDER_CATALOG_SYNC_JOB_SCHEMA,
        state: "queued",
      }),
      status: "queued",
      type: JOB_TYPE,
      updatedAt: now,
    };
    await this.repository.createBackgroundJob(job);
    return { job: publicJob(job), mode: "async_job" as const };
  }

  async run(input: {
    jobId: string;
    providerId: string;
    subject: AuthSubject;
  }) {
    await this.read(input.subject, input.jobId, input.providerId);
    return (
      (await this.runNext({
        jobId: input.jobId,
        subject: input.subject,
        workerId: `provider_catalog_api_${input.subject.id}`,
      })) ?? (await this.get(input))
    );
  }

  async runNext(input: {
    subject: AuthSubject;
    workerId: string;
    jobId?: string;
  }) {
    assertScope(input.subject, "providers:write");
    const claimed = await this.repository.claimBackgroundJob({
      ...(input.jobId === undefined ? {} : { jobId: input.jobId }),
      leaseSeconds: LEASE_SECONDS,
      orgId: input.subject.orgId,
      type: JOB_TYPE,
      workerId: input.workerId,
    });
    if (claimed === undefined) return undefined;
    const payload = parsePayload(claimed.payload);
    const leaseAttempt = workerLeaseAttempt(claimed.payload);
    if (leaseAttempt === undefined)
      throw new Error("provider_catalog_sync_lease_missing");
    if (payload === undefined) {
      const failedAt = new Date().toISOString();
      await this.repository.updateBackgroundJobWithLease({
        job: {
          ...claimed,
          completedAt: failedAt,
          payload: {
            ...claimed.payload,
            error: "provider_catalog_sync_job_invalid",
          },
          status: "failed",
          updatedAt: failedAt,
        },
        leaseAttempt,
        now: failedAt,
        workerId: input.workerId,
      });
      return undefined;
    }
    const running = await this.fencedUpdate(
      claimed,
      leaseAttempt,
      input.workerId,
      { ...payload, percent: 10, state: "running" },
    );
    try {
      const models = await this.sync(input.subject, payload.providerId);
      const completedAt = new Date().toISOString();
      const completed = await this.repository.updateBackgroundJobWithLease({
        job: {
          ...running,
          completedAt,
          payload: catalogSyncPayload(
            {
              ...payload,
              modelCount: models.length,
              percent: 100,
              state: "ready",
            },
            running.payload,
          ),
          status: "completed",
          updatedAt: completedAt,
        },
        leaseAttempt,
        now: completedAt,
        workerId: input.workerId,
      });
      if (completed === undefined)
        throw new Error("provider_catalog_sync_lease_lost");
      return publicJob(completed);
    } catch (caught) {
      const failedAt = new Date().toISOString();
      const failed = await this.repository.updateBackgroundJobWithLease({
        job: {
          ...running,
          completedAt: failedAt,
          payload: catalogSyncPayload(
            {
              ...payload,
              error: safeError(caught),
              percent: 100,
              state: "failed",
            },
            running.payload,
          ),
          status: "failed",
          updatedAt: failedAt,
        },
        leaseAttempt,
        now: failedAt,
        workerId: input.workerId,
      });
      if (failed === undefined)
        throw new Error("provider_catalog_sync_lease_lost");
      return publicJob(failed);
    }
  }

  async get(input: {
    jobId: string;
    providerId: string;
    subject: AuthSubject;
  }) {
    return publicJob(
      await this.read(input.subject, input.jobId, input.providerId),
    );
  }

  private async findActive(providerId: string, orgId: string) {
    const [job] = await this.repository.listBackgroundJobs(orgId, {
      limit: 1,
      payloadEquals: { providerId },
      statuses: ["queued", "running"],
      type: JOB_TYPE,
    });
    return job;
  }

  private async read(subject: AuthSubject, jobId: string, providerId: string) {
    assertScope(subject, "providers:write");
    const job = await this.repository.getBackgroundJob(subject.orgId, jobId);
    const payload = job === undefined ? undefined : parsePayload(job.payload);
    if (
      job === undefined ||
      job.type !== JOB_TYPE ||
      payload?.providerId !== providerId
    )
      throw notFound("Catalog sync job");
    return job;
  }

  private async fencedUpdate(
    job: BackgroundJob,
    leaseAttempt: number,
    workerId: string,
    payload: CatalogSyncPayload,
  ) {
    const updatedAt = new Date().toISOString();
    const updated = await this.repository.updateBackgroundJobWithLease({
      job: {
        ...job,
        payload: catalogSyncPayload(payload, job.payload),
        status: "running",
        updatedAt,
      },
      leaseAttempt,
      now: updatedAt,
      workerId,
    });
    if (updated === undefined)
      throw new Error("provider_catalog_sync_lease_lost");
    return updated;
  }
}

function parsePayload(
  payload: Record<string, unknown>,
): CatalogSyncPayload | undefined {
  if (
    payload.schema !== PROVIDER_CATALOG_SYNC_JOB_SCHEMA ||
    typeof payload.providerId !== "string" ||
    typeof payload.modelCount !== "number" ||
    typeof payload.percent !== "number" ||
    (payload.state !== "queued" &&
      payload.state !== "running" &&
      payload.state !== "ready" &&
      payload.state !== "failed")
  )
    return undefined;
  return {
    modelCount: payload.modelCount,
    percent: payload.percent,
    providerId: payload.providerId,
    schema: PROVIDER_CATALOG_SYNC_JOB_SCHEMA,
    state: payload.state,
    ...(typeof payload.error === "string" ? { error: payload.error } : {}),
  };
}

function catalogSyncPayload(
  payload: CatalogSyncPayload,
  source: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...source,
    modelCount: payload.modelCount,
    percent: payload.percent,
    providerId: payload.providerId,
    schema: payload.schema,
    state: payload.state,
    ...(payload.error === undefined ? {} : { error: payload.error }),
  };
}

function publicJob(job: BackgroundJob) {
  const payload = parsePayload(job.payload);
  if (payload === undefined)
    throw new Error("provider_catalog_sync_job_invalid");
  return {
    jobId: job.id,
    modelCount: payload.modelCount,
    percent: payload.percent,
    providerId: payload.providerId,
    state: payload.state,
    ...(payload.error === undefined ? {} : { error: payload.error }),
  };
}

function workerLeaseAttempt(payload: Record<string, unknown>) {
  const lease = payload.workerLease;
  if (lease === null || typeof lease !== "object" || Array.isArray(lease))
    return undefined;
  const attempt = (lease as Record<string, unknown>).attempt;
  return typeof attempt === "number" && Number.isSafeInteger(attempt)
    ? attempt
    : undefined;
}

function safeError(caught: unknown) {
  if (!(caught instanceof Error)) return "Provider catalog sync failed.";
  const code = caught.message.match(/^[a-z][a-z0-9_]{2,100}$/u)?.[0];
  return code ?? "Provider catalog sync failed.";
}

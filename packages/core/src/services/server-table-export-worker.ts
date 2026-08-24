import { assertScope, hasWorkspaceAccess, type AuthSubject } from "@romeo/auth";
import type { ObjectStore } from "@romeo/storage";

import type { BackgroundJob } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { writeAuditLog } from "./audit-log";
import { deleteTableExport } from "./server-table-export-cleanup";
import {
  authorizeTableExportJob,
  TABLE_EXPORT_ARTIFACT_SCHEMA,
  type FrozenTableExportSnapshot,
  type TableExportArtifact,
  type TableExportJob,
} from "./server-table-export-job";
import {
  boundedExportProgress,
  cleanExportPayload,
  createExportJobPayload,
  deleteExportObjects,
  encodeCsvPart,
  exportErrorCode,
  exportManifestKey,
  exportPartKey,
  objectPartStream,
  parseExportManifest,
  parseExportPayload,
  publicExportJob,
  safeFilePart,
  TABLE_EXPORT_ARTIFACT_TTL_MS,
  TABLE_EXPORT_JOB_TYPE,
  TABLE_EXPORT_LEASE_SECONDS,
  TABLE_EXPORT_MANIFEST_SCHEMA,
  TABLE_EXPORT_MAX_ATTEMPTS,
  TABLE_EXPORT_MAX_MANIFEST_BYTES,
  TABLE_EXPORT_MAX_PART_BYTES,
  TABLE_EXPORT_PAGE_SIZE,
  workerLeaseAttempt,
  type ExportJobPayload,
  type ExportManifest,
} from "./server-table-export-support";
import type { InventoriedTablePageService } from "./inventoried-table-page-service";
import { ServerTableExportScheduler } from "./server-table-export-scheduler";

export class ServerTableExportWorker {
  private readonly scheduler: ServerTableExportScheduler;

  constructor(
    private readonly repository: RomeoRepository,
    private readonly tablePages: InventoriedTablePageService,
    private readonly objectStore: ObjectStore,
  ) {
    this.scheduler = new ServerTableExportScheduler(repository, (input) =>
      this.runNext(input),
    );
  }

  async create(input: {
    subject: AuthSubject;
    workspaceId: string;
    parentId?: string;
    resource: string;
    mode: "browser_csv" | "async_artifact";
    estimatedRows: number;
    sort: FrozenTableExportSnapshot["applied"]["sort"];
    filters: FrozenTableExportSnapshot["applied"]["filters"];
    search?: string;
  }): Promise<
    | { outcome: "denied"; code: "table_export_must_be_async" }
    | { outcome: "accepted"; job: TableExportJob }
  > {
    await this.assertWorkspace(input.subject, input.workspaceId);
    const authorized = authorizeTableExportJob({
      mode: input.mode,
      estimatedRows: input.estimatedRows,
    });
    if (authorized.outcome === "denied") return authorized;
    const now = new Date().toISOString();
    const payload = createExportJobPayload({
      actorId: input.subject.id,
      estimatedRows: input.estimatedRows,
      filters: input.filters,
      now,
      orgId: input.subject.orgId,
      ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
      resource: input.resource,
      sort: input.sort,
      ...(input.search === undefined ? {} : { search: input.search }),
      workspaceId: input.workspaceId,
    });
    const jobId = createId("export_job");
    await this.repository.createBackgroundJob({
      id: jobId,
      orgId: input.subject.orgId,
      workspaceId: input.workspaceId,
      type: TABLE_EXPORT_JOB_TYPE,
      status: "queued",
      payload: payload as unknown as Record<string, unknown>,
      createdAt: now,
      updatedAt: now,
    });
    await writeAuditLog(this.repository, {
      subject: input.subject,
      action: "admin.table_export.create",
      resourceType: "table_export",
      resourceId: jobId,
      metadata: {
        resource: input.resource,
        estimatedRows: input.estimatedRows,
        mode: "async_artifact",
      },
    });
    return { outcome: "accepted", job: publicExportJob(jobId, payload) };
  }

  start(): void {
    this.scheduler.start();
  }

  stop(): void {
    this.scheduler.stop();
  }

  drain(): Promise<void> {
    return this.scheduler.drain();
  }

  async runNext(input: {
    subject: AuthSubject;
    workerId: string;
    jobId?: string;
    now?: string;
    signal?: AbortSignal;
  }): Promise<TableExportJob | undefined> {
    assertScope(input.subject, "admin:read");
    const now = input.now ?? new Date().toISOString();
    const claimed = await this.repository.claimBackgroundJob({
      leaseSeconds: TABLE_EXPORT_LEASE_SECONDS,
      ...(input.jobId === undefined ? {} : { jobId: input.jobId }),
      now,
      orgId: input.subject.orgId,
      type: TABLE_EXPORT_JOB_TYPE,
      workerId: input.workerId,
    });
    if (claimed === undefined) return undefined;
    const leaseAttempt = workerLeaseAttempt(claimed.payload);
    const payload = parseExportPayload(claimed.payload);
    if (leaseAttempt === undefined || payload === undefined) {
      await this.repository.updateBackgroundJob({
        ...claimed,
        status: "failed",
        completedAt: now,
        payload: { ...claimed.payload, errorCode: "table_export_job_invalid" },
        updatedAt: now,
      });
      return undefined;
    }
    try {
      return await this.processClaim({
        claimed,
        input,
        leaseAttempt,
        payload: {
          ...payload,
          state: "running",
          attemptCount: Math.max(payload.attemptCount, leaseAttempt),
          percent: Math.max(1, payload.percent),
        },
      });
    } catch (error) {
      const checkpoint = await this.storedJob(input.subject.orgId, claimed.id);
      return this.failClaim({
        claimed: checkpoint ?? claimed,
        input,
        leaseAttempt,
        payload:
          (checkpoint === undefined
            ? undefined
            : parseExportPayload(checkpoint.payload)) ?? payload,
        errorCode: exportErrorCode(error),
      });
    }
  }

  async run(input: { subject: AuthSubject; jobId: string }) {
    if (
      input.subject.type !== "service_account" ||
      !input.subject.id.startsWith("system_table_export_")
    )
      throw new ApiError(
        "forbidden",
        "Table export execution is restricted to the internal worker.",
        403,
      );
    const job = await this.runNext({
      subject: input.subject,
      workerId: input.subject.id,
      jobId: input.jobId,
    });
    if (job === undefined || job.id !== input.jobId)
      throw notFound("Table export");
    return job;
  }

  async get(input: {
    subject: AuthSubject;
    jobId: string;
    now?: string;
  }): Promise<TableExportJob> {
    assertScope(input.subject, "admin:read");
    const stored = await this.storedJob(input.subject.orgId, input.jobId);
    if (stored === undefined) throw notFound("Table export");
    const payload = parseExportPayload(stored.payload);
    if (payload === undefined) throw notFound("Table export");
    await this.assertWorkspace(input.subject, payload.snapshot.workspaceId);
    const now = input.now ?? new Date().toISOString();
    if (
      payload.artifact !== undefined &&
      Date.parse(payload.artifact.expiresAt) <= Date.parse(now)
    ) {
      await this.cleanupArtifact(payload.artifact.key);
      const { artifact: _artifact, ...withoutArtifact } = payload;
      const expired: ExportJobPayload = {
        ...withoutArtifact,
        state: "expired",
      };
      await this.repository.updateBackgroundJob({
        ...stored,
        payload: cleanExportPayload(expired),
        updatedAt: now,
      });
      return publicExportJob(stored.id, expired);
    }
    return publicExportJob(stored.id, payload);
  }

  async readArtifact(input: {
    subject: AuthSubject;
    jobId: string;
    now?: string;
  }): Promise<TableExportArtifact> {
    const job = await this.get(input);
    const stored = await this.storedJob(input.subject.orgId, input.jobId);
    const payload =
      stored === undefined ? undefined : parseExportPayload(stored.payload);
    if (job.state !== "artifact_ready" || payload?.artifact === undefined)
      throw notFound("Table export artifact");
    const manifest = await this.readManifest(payload.artifact.key);
    if (
      manifest === undefined ||
      manifest.jobId !== job.id ||
      manifest.orgId !== input.subject.orgId ||
      manifest.workspaceId !== job.snapshot.workspaceId
    )
      throw notFound("Table export artifact");
    return {
      schema: TABLE_EXPORT_ARTIFACT_SCHEMA,
      id: payload.artifact.artifactId,
      jobId: job.id,
      orgId: manifest.orgId,
      workspaceId: manifest.workspaceId,
      fileName: payload.artifact.fileName,
      body: objectPartStream(this.objectStore, manifest.partKeys),
      contentType: payload.artifact.contentType,
      sizeBytes: payload.artifact.sizeBytes,
      createdAt: manifest.createdAt,
      expiresAt: manifest.expiresAt,
    };
  }

  async remove(input: { subject: AuthSubject; jobId: string }) {
    await this.get(input);
    return deleteTableExport({
      ...input,
      objectStore: this.objectStore,
      repository: this.repository,
    });
  }

  private async processClaim(input: {
    claimed: BackgroundJob;
    input: { subject: AuthSubject; workerId: string; signal?: AbortSignal };
    leaseAttempt: number;
    payload: ExportJobPayload;
  }): Promise<TableExportJob> {
    let job = input.claimed;
    let payload = input.payload;
    let cursor = payload.cursor;
    do {
      if (input.input.signal?.aborted) throw new Error("table_export_aborted");
      const page = await this.tablePages.query(input.input.subject, {
        resource: payload.snapshot.resource,
        workspaceId: payload.snapshot.workspaceId,
        ...(payload.snapshot.parentId === undefined
          ? {}
          : { parentId: payload.snapshot.parentId }),
        limit: TABLE_EXPORT_PAGE_SIZE,
        sort: payload.snapshot.applied.sort,
        filters: payload.snapshot.applied.filters,
        ...(payload.snapshot.applied.search === undefined
          ? {}
          : { search: payload.snapshot.applied.search }),
        snapshotAt: payload.snapshot.frozenAt,
        ...(cursor === undefined ? {} : { cursor }),
      });
      const columns =
        payload.columns ??
        [...new Set(page.items.flatMap((row) => Object.keys(row)))].sort();
      const bytes = encodeCsvPart(
        page.items,
        payload.partKeys.length === 0,
        columns,
      );
      if (bytes.byteLength > TABLE_EXPORT_MAX_PART_BYTES)
        throw new Error("table_export_part_too_large");
      const partKey = exportPartKey(
        payload.snapshot.orgId,
        input.claimed.id,
        input.leaseAttempt,
        payload.partKeys.length,
      );
      await this.objectStore.putObject({
        key: partKey,
        body: bytes,
        contentType: "text/csv; charset=utf-8",
      });
      cursor = page.page.nextCursor ?? undefined;
      const processedRows = payload.processedRows + page.items.length;
      payload = {
        ...payload,
        state: "running",
        columns,
        processedRows,
        partKeys: [...payload.partKeys, partKey],
        sizeBytes: payload.sizeBytes + bytes.byteLength,
        percent: boundedExportProgress(
          processedRows,
          payload.snapshot.estimatedRows,
        ),
        ...(cursor === undefined ? {} : { cursor }),
      };
      job = await this.fencedUpdate(job, payload, input);
      await this.repository.renewBackgroundJobLease({
        jobId: job.id,
        leaseAttempt: input.leaseAttempt,
        leaseSeconds: TABLE_EXPORT_LEASE_SECONDS,
        orgId: job.orgId,
        workerId: input.input.workerId,
      });
    } while (cursor !== undefined);
    return this.completeClaim(job, payload, input);
  }

  private async completeClaim(
    job: BackgroundJob,
    payload: ExportJobPayload,
    input: { input: { workerId: string }; leaseAttempt: number },
  ) {
    const completedAt = new Date().toISOString();
    const artifactId = createId("file_export");
    const expiresAt = new Date(
      Date.parse(completedAt) + TABLE_EXPORT_ARTIFACT_TTL_MS,
    ).toISOString();
    const manifestKey = exportManifestKey(
      payload.snapshot.orgId,
      job.id,
      input.leaseAttempt,
    );
    const manifest: ExportManifest = {
      schema: TABLE_EXPORT_MANIFEST_SCHEMA,
      jobId: job.id,
      orgId: payload.snapshot.orgId,
      workspaceId: payload.snapshot.workspaceId,
      partKeys: payload.partKeys,
      sizeBytes: payload.sizeBytes,
      createdAt: completedAt,
      expiresAt,
    };
    await this.objectStore.putObject({
      key: manifestKey,
      body: new TextEncoder().encode(JSON.stringify(manifest)),
      contentType: "application/json",
    });
    const { cursor: _cursor, ...withoutCursor } = payload;
    const completePayload: ExportJobPayload = {
      ...withoutCursor,
      state: "artifact_ready",
      percent: 100,
      partKeys: [],
      artifact: {
        artifactId,
        key: manifestKey,
        fileName: `${safeFilePart(payload.snapshot.resource)}-${job.id}.csv`,
        contentType: "text/csv; charset=utf-8",
        sizeBytes: payload.sizeBytes,
        expiresAt,
      },
    };
    const completed = await this.repository.updateBackgroundJobWithLease({
      job: {
        ...job,
        status: "completed",
        completedAt,
        updatedAt: completedAt,
        payload: cleanExportPayload(completePayload),
      },
      leaseAttempt: input.leaseAttempt,
      workerId: input.input.workerId,
      now: completedAt,
    });
    if (completed === undefined) throw new Error("table_export_lease_lost");
    return publicExportJob(job.id, completePayload);
  }

  private async failClaim(input: {
    claimed: BackgroundJob;
    input: { workerId: string };
    leaseAttempt: number;
    payload: ExportJobPayload;
    errorCode: string;
  }): Promise<TableExportJob> {
    const failedAt = new Date().toISOString();
    const terminal = input.leaseAttempt >= TABLE_EXPORT_MAX_ATTEMPTS;
    const failedPayload: ExportJobPayload = {
      ...input.payload,
      state: terminal ? "failed" : "queued",
      attemptCount: input.leaseAttempt,
      errorCode: input.errorCode,
    };
    const updated = await this.repository.updateBackgroundJobWithLease({
      job: {
        ...input.claimed,
        status: terminal ? "failed" : "queued",
        ...(terminal ? { completedAt: failedAt } : {}),
        updatedAt: failedAt,
        payload: failedPayload as unknown as Record<string, unknown>,
      },
      leaseAttempt: input.leaseAttempt,
      workerId: input.input.workerId,
      now: failedAt,
    });
    if (updated === undefined) throw new Error("table_export_lease_lost");
    if (terminal)
      await deleteExportObjects(this.objectStore, failedPayload.partKeys);
    return publicExportJob(input.claimed.id, failedPayload);
  }

  private async fencedUpdate(
    job: BackgroundJob,
    payload: ExportJobPayload,
    input: { input: { workerId: string }; leaseAttempt: number },
  ) {
    const updated = await this.repository.updateBackgroundJobWithLease({
      job: {
        ...job,
        status: "running",
        payload: payload as unknown as Record<string, unknown>,
        updatedAt: new Date().toISOString(),
      },
      leaseAttempt: input.leaseAttempt,
      workerId: input.input.workerId,
    });
    if (updated === undefined) throw new Error("table_export_lease_lost");
    return updated;
  }

  private async storedJob(orgId: string, jobId: string) {
    const job = await this.repository.getBackgroundJob(orgId, jobId);
    return job?.type === TABLE_EXPORT_JOB_TYPE ? job : undefined;
  }

  private async readManifest(key: string) {
    const bytes = await this.objectStore.getObject(key, {
      maxBytes: TABLE_EXPORT_MAX_MANIFEST_BYTES,
    });
    if (bytes === undefined) return undefined;
    return parseExportManifest(JSON.parse(new TextDecoder().decode(bytes)));
  }

  private async cleanupArtifact(key: string) {
    const manifest = await this.readManifest(key).catch(() => undefined);
    if (manifest !== undefined)
      await deleteExportObjects(this.objectStore, manifest.partKeys);
    await this.objectStore.deleteObject(key);
  }

  private async assertWorkspace(subject: AuthSubject, workspaceId: string) {
    assertScope(subject, "admin:read");
    const workspace = await this.repository.getWorkspace(workspaceId);
    if (
      workspace === undefined ||
      workspace.orgId !== subject.orgId ||
      !hasWorkspaceAccess(subject, workspaceId)
    )
      throw notFound("Workspace");
  }
}

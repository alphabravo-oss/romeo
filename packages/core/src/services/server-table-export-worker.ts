import { assertScope, hasWorkspaceAccess, type AuthSubject } from "@romeo/auth";

import type { RomeoRepository } from "../domain/repository";
import { notFound } from "../errors";
import { createId } from "../ids";
import { writeAuditLog } from "./audit-log";
import {
  completeBackgroundJob,
  queueBackgroundJob,
} from "./job-service";
import {
  advanceTableExportJob,
  authorizeTableExportJob,
  expireTableExportArtifact,
  freezeTableExportSnapshot,
  tableExportProgressEvent,
  type FrozenTableExportSnapshot,
  type TableExportJob,
} from "./server-table-export-job";

const SCHEMA = "romeo.server-table-export-store.v1";

export class ServerTableExportWorker {
  constructor(private readonly repository: RomeoRepository) {}

  async create(input: {
    subject: AuthSubject;
    workspaceId: string;
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
    const snapshot = freezeTableExportSnapshot({
      orgId: input.subject.orgId,
      workspaceId: input.workspaceId,
      resource: input.resource,
      actorId: input.subject.id,
      policyVersion: `${input.resource}:v1`,
      sort: input.sort,
      filters: input.filters,
      ...(input.search === undefined ? {} : { search: input.search }),
      estimatedRows: input.estimatedRows,
      now,
    });
    const job: TableExportJob = {
      id: createId("export_job"),
      snapshot,
      state: "queued",
      percent: 0,
    };
    await queueBackgroundJob(this.repository, {
      id: job.id,
      orgId: input.subject.orgId,
      workspaceId: input.workspaceId,
      type: "table.export",
      payload: {
        resource: input.resource,
        estimatedRows: input.estimatedRows,
        mode: "async_artifact",
      },
    });
    await this.save(job);
    await writeAuditLog(this.repository, {
      subject: input.subject,
      action: "admin.table_export.create",
      resourceType: "table_export",
      resourceId: job.id,
      metadata: {
        resource: input.resource,
        estimatedRows: input.estimatedRows,
        mode: "async_artifact",
      },
    });
    return { outcome: "accepted", job };
  }

  async run(input: {
    subject: AuthSubject;
    jobId: string;
    now?: string;
  }): Promise<TableExportJob> {
    const job = await this.get(input);
    const now = input.now ?? new Date().toISOString();
    let next = expireTableExportArtifact(job, now);
    if (next.state === "expired") {
      await this.save(next);
      return next;
    }
    next = advanceTableExportJob(next, { type: "start" });
    next = advanceTableExportJob(next, { type: "progress", percent: 50 });
    const expiresAt = new Date(Date.parse(now) + 3_600_000).toISOString();
    next = advanceTableExportJob(next, {
      type: "complete",
      artifactId: createId("file_export"),
      expiresAt,
    });
    await this.save(next);
    const background = (await this.repository.listBackgroundJobs(
      input.subject.orgId,
    )).find((item) => item.id === input.jobId);
    if (background !== undefined)
      await completeBackgroundJob(this.repository, background);
    void tableExportProgressEvent({
      jobId: next.id,
      sequence: 1,
      percent: 100,
      stage: "complete",
    });
    return next;
  }

  async get(input: {
    subject: AuthSubject;
    jobId: string;
    now?: string;
  }): Promise<TableExportJob> {
    assertScope(input.subject, "admin:read");
    const stored = await this.read(input.subject.orgId, input.jobId);
    if (stored === undefined) throw notFound("Table export");
    const now = input.now ?? new Date().toISOString();
    const expired = expireTableExportArtifact(stored, now);
    if (expired.state !== stored.state) await this.save(expired);
    return expired;
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

  private async read(
    orgId: string,
    jobId: string,
  ): Promise<TableExportJob | undefined> {
    const value = (await this.repository.getSystemSetting(storeKey(orgId, jobId)))
      ?.value;
    if (value === null || typeof value !== "object" || Array.isArray(value))
      return undefined;
    const candidate = value as Record<string, unknown>;
    if (candidate.schema !== SCHEMA || candidate.orgId !== orgId) return undefined;
    return candidate.job as TableExportJob;
  }

  private async save(job: TableExportJob): Promise<void> {
    await this.repository.upsertSystemSetting({
      key: storeKey(job.snapshot.orgId, job.id),
      value: { schema: SCHEMA, orgId: job.snapshot.orgId, job },
      updatedAt: job.snapshot.frozenAt,
    });
  }
}

function storeKey(orgId: string, jobId: string): string {
  return `table_export.v1:${orgId}:${jobId}`;
}

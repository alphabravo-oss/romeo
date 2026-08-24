import type {
  ClaimBackgroundJobInput,
  ListBackgroundJobsInput,
  RenewBackgroundJobLeaseInput,
  UpdateBackgroundJobWithLeaseInput,
} from "@romeo/core";
import { assertUsageEventTaxonomy, assertUsageEventUpdate } from "@romeo/core";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import { backgroundJobs, systemSettings, usageEvents } from "./schema";
import { optionalDate } from "./repository-mapping";
import type {
  BackgroundJobRecord,
  SystemSettingRecord,
  UsageEventRecord,
} from "./operational-records";
import {
  assertSettingScope,
  toBackgroundJobInsert,
  toBackgroundJobRecord,
  toSystemSettingInsert,
  toSystemSettingRecord,
  toUsageEventInsert,
  toUsageEventRecord,
} from "./operational-record-mapping";
import { PgAuditRepository } from "./audit-repository";
import {
  applyWorkerLease,
  readWorkerLease,
  renewWorkerLease,
} from "./operational-worker-lease";

export type * from "./operational-records";
export { toAuditLogRecord } from "./audit-repository";
export {
  toBackgroundJobRecord,
  toSystemSettingRecord,
  toUsageEventRecord,
} from "./operational-record-mapping";

export class PgOperationalRepository extends PgAuditRepository {
  constructor(db: RomeoDatabase) {
    super(db);
  }

  async getSystemSetting(
    key: string,
    orgId: string | null,
  ): Promise<SystemSettingRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(systemSettings)
      .where(
        and(
          eq(systemSettings.key, key),
          orgId === null
            ? isNull(systemSettings.orgId)
            : eq(systemSettings.orgId, orgId),
        ),
      )
      .limit(1);
    return row === undefined ? undefined : toSystemSettingRecord(row);
  }

  async listSystemSettings(
    orgId: string | null,
  ): Promise<SystemSettingRecord[]> {
    const rows = await this.db
      .select()
      .from(systemSettings)
      .where(
        orgId === null
          ? isNull(systemSettings.orgId)
          : eq(systemSettings.orgId, orgId),
      )
      .orderBy(asc(systemSettings.key));
    return rows.map(toSystemSettingRecord);
  }

  async upsertSystemSetting(
    setting: SystemSettingRecord,
    orgId: string | null,
  ): Promise<SystemSettingRecord> {
    assertSettingScope(setting, orgId);
    const [row] = await this.db
      .insert(systemSettings)
      .values(toSystemSettingInsert(setting, orgId))
      .onConflictDoUpdate({
        target: [systemSettings.scopeOrgId, systemSettings.key],
        set: {
          value: setting.value,
          updatedAt: new Date(setting.updatedAt),
        },
      })
      .returning();
    return row === undefined ? setting : toSystemSettingRecord(row);
  }

  async listUsageEvents(orgId: string): Promise<UsageEventRecord[]> {
    const rows = await this.db
      .select()
      .from(usageEvents)
      .where(eq(usageEvents.orgId, orgId))
      .orderBy(desc(usageEvents.createdAt), asc(usageEvents.id));
    return rows.map(toUsageEventRecord);
  }

  async listUsageEventsForRun(
    orgId: string,
    workspaceId: string,
    runId: string,
    limit: number,
  ): Promise<UsageEventRecord[]> {
    const rows = await this.db
      .select()
      .from(usageEvents)
      .where(
        and(
          eq(usageEvents.orgId, orgId),
          eq(usageEvents.workspaceId, workspaceId),
          eq(usageEvents.sourceType, "run"),
          eq(usageEvents.sourceId, runId),
        ),
      )
      .orderBy(desc(usageEvents.createdAt), asc(usageEvents.id))
      .limit(Math.max(0, limit));
    return rows.map(toUsageEventRecord);
  }

  async createUsageEvent(event: UsageEventRecord): Promise<UsageEventRecord> {
    assertUsageEventTaxonomy(event);
    const [row] = await this.db
      .insert(usageEvents)
      .values(toUsageEventInsert(event))
      .returning();
    return row === undefined ? event : toUsageEventRecord(row);
  }

  async updateUsageEvent(event: UsageEventRecord): Promise<UsageEventRecord> {
    const [currentRow] = await this.db
      .select()
      .from(usageEvents)
      .where(eq(usageEvents.id, event.id))
      .limit(1);
    if (currentRow === undefined)
      throw new Error(`Usage event ${event.id} does not exist.`);
    const current = toUsageEventRecord(currentRow);
    assertUsageEventUpdate(current, event);
    const [row] = await this.db
      .update(usageEvents)
      .set({ quantity: event.quantity, metadata: event.metadata })
      .where(
        and(
          eq(usageEvents.id, currentRow.id),
          eq(usageEvents.orgId, currentRow.orgId),
          currentRow.workspaceId === null
            ? isNull(usageEvents.workspaceId)
            : eq(usageEvents.workspaceId, currentRow.workspaceId),
          eq(usageEvents.actorId, currentRow.actorId),
          eq(usageEvents.sourceType, currentRow.sourceType),
          eq(usageEvents.sourceId, currentRow.sourceId),
          eq(usageEvents.metric, currentRow.metric),
          eq(usageEvents.quantity, currentRow.quantity),
          eq(usageEvents.unit, currentRow.unit),
          eq(usageEvents.metadata, currentRow.metadata),
          eq(usageEvents.createdAt, currentRow.createdAt),
        ),
      )
      .returning();
    if (row === undefined)
      throw new Error(`Usage event ${event.id} changed concurrently.`);
    return toUsageEventRecord(row);
  }

  async getBackgroundJob(
    orgId: string,
    jobId: string,
  ): Promise<BackgroundJobRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(backgroundJobs)
      .where(and(eq(backgroundJobs.orgId, orgId), eq(backgroundJobs.id, jobId)))
      .limit(1);
    return row === undefined ? undefined : toBackgroundJobRecord(row);
  }

  async listBackgroundJobs(
    orgId: string,
    input: ListBackgroundJobsInput = { limit: 100 },
  ): Promise<BackgroundJobRecord[]> {
    const rows = await this.db
      .select()
      .from(backgroundJobs)
      .where(
        and(
          eq(backgroundJobs.orgId, orgId),
          ...(input.type === undefined
            ? []
            : [eq(backgroundJobs.type, input.type)]),
          ...(input.statuses === undefined || input.statuses.length === 0
            ? []
            : [inArray(backgroundJobs.status, input.statuses)]),
          ...backgroundJobPayloadEquals(input.payloadEquals),
          ...(input.cursor === undefined
            ? []
            : [backgroundJobAfterCursor(input)]),
        ),
      )
      .orderBy(
        input.order === "asc"
          ? asc(backgroundJobs.createdAt)
          : desc(backgroundJobs.createdAt),
        asc(backgroundJobs.id),
      )
      .limit(Math.max(0, input.limit));
    return rows.map(toBackgroundJobRecord);
  }

  async createBackgroundJob(
    job: BackgroundJobRecord,
  ): Promise<BackgroundJobRecord> {
    const [row] = await this.db
      .insert(backgroundJobs)
      .values(toBackgroundJobInsert(job))
      .returning();
    return row === undefined ? job : toBackgroundJobRecord(row);
  }

  async claimBackgroundJob(
    input: ClaimBackgroundJobInput,
  ): Promise<BackgroundJobRecord | undefined> {
    const now = input.now ?? new Date().toISOString();
    const nowDate = new Date(now);
    const staleBefore = new Date(
      nowDate.getTime() - Math.max(1, input.leaseSeconds) * 1000,
    );
    const claimable = claimableBackgroundJobWhere(input, staleBefore);
    return this.db.transaction(async (transaction) => {
      const [candidate] = await transaction
        .select()
        .from(backgroundJobs)
        .where(claimable)
        .orderBy(asc(backgroundJobs.createdAt), asc(backgroundJobs.id))
        .limit(1)
        .for("update", { skipLocked: true });
      if (candidate === undefined) return undefined;
      const job = toBackgroundJobRecord(candidate);
      const [row] = await transaction
        .update(backgroundJobs)
        .set({
          payload: applyWorkerLease(job, input, now).payload,
          status: "running",
          updatedAt: nowDate,
        })
        .where(
          and(
            eq(backgroundJobs.id, job.id),
            eq(backgroundJobs.orgId, input.orgId),
          ),
        )
        .returning();
      return row === undefined ? undefined : toBackgroundJobRecord(row);
    });
  }

  async renewBackgroundJobLease(
    input: RenewBackgroundJobLeaseInput,
  ): Promise<BackgroundJobRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(backgroundJobs)
      .where(
        and(
          eq(backgroundJobs.id, input.jobId),
          eq(backgroundJobs.orgId, input.orgId),
          eq(backgroundJobs.status, "running"),
        ),
      )
      .limit(1);
    if (row === undefined) return undefined;

    const now = input.now ?? new Date().toISOString();
    const job = toBackgroundJobRecord(row);
    const lease = readWorkerLease(job.payload);
    if (
      lease === undefined ||
      lease.workerId !== input.workerId ||
      (input.leaseAttempt !== undefined &&
        lease.attempt !== input.leaseAttempt) ||
      Date.parse(lease.expiresAt) <= Date.parse(now)
    ) {
      return undefined;
    }

    const [updated] = await this.db
      .update(backgroundJobs)
      .set({
        payload: renewWorkerLease(job, input, now, lease).payload,
        updatedAt: new Date(now),
      })
      .where(
        and(
          eq(backgroundJobs.id, input.jobId),
          eq(backgroundJobs.orgId, input.orgId),
          eq(backgroundJobs.status, "running"),
          eq(backgroundJobs.updatedAt, row.updatedAt),
        ),
      )
      .returning();
    return updated === undefined ? undefined : toBackgroundJobRecord(updated);
  }

  async updateBackgroundJob(
    job: BackgroundJobRecord,
  ): Promise<BackgroundJobRecord> {
    const [row] = await this.db
      .update(backgroundJobs)
      .set({
        completedAt: optionalDate(job.completedAt),
        payload: job.payload,
        status: job.status,
        type: job.type,
        updatedAt: new Date(job.updatedAt),
      })
      .where(eq(backgroundJobs.id, job.id))
      .returning();
    return row === undefined ? job : toBackgroundJobRecord(row);
  }

  async updateBackgroundJobWithLease(
    input: UpdateBackgroundJobWithLeaseInput,
  ): Promise<BackgroundJobRecord | undefined> {
    const [currentRow] = await this.db
      .select()
      .from(backgroundJobs)
      .where(
        and(
          eq(backgroundJobs.id, input.job.id),
          eq(backgroundJobs.orgId, input.job.orgId),
          eq(backgroundJobs.status, "running"),
        ),
      )
      .limit(1);
    if (currentRow === undefined) return undefined;
    const current = toBackgroundJobRecord(currentRow);
    const lease = readWorkerLease(current.payload);
    const now = input.now ?? new Date().toISOString();
    if (
      lease === undefined ||
      lease.workerId !== input.workerId ||
      (input.leaseAttempt !== undefined &&
        lease.attempt !== input.leaseAttempt) ||
      Date.parse(lease.expiresAt) <= Date.parse(now)
    )
      return undefined;
    const [updated] = await this.db
      .update(backgroundJobs)
      .set({
        completedAt: optionalDate(input.job.completedAt),
        payload: { ...input.job.payload, workerLease: lease },
        status: input.job.status,
        type: input.job.type,
        updatedAt: new Date(input.job.updatedAt),
      })
      .where(
        and(
          eq(backgroundJobs.id, input.job.id),
          eq(backgroundJobs.orgId, input.job.orgId),
          eq(backgroundJobs.status, "running"),
          eq(backgroundJobs.updatedAt, currentRow.updatedAt),
        ),
      )
      .returning();
    return updated === undefined ? undefined : toBackgroundJobRecord(updated);
  }
}

function claimableBackgroundJobWhere(
  input: ClaimBackgroundJobInput,
  staleBefore: Date,
) {
  return and(
    eq(backgroundJobs.orgId, input.orgId),
    eq(backgroundJobs.type, input.type),
    ...(input.jobId === undefined ? [] : [eq(backgroundJobs.id, input.jobId)]),
    ...backgroundJobPayloadEquals(input.payloadEquals),
    or(
      eq(backgroundJobs.status, "queued"),
      and(
        eq(backgroundJobs.status, "running"),
        lte(backgroundJobs.updatedAt, staleBefore),
      ),
    ),
  );
}

function backgroundJobPayloadEquals(
  payload: Readonly<Record<string, string>> | undefined,
) {
  return Object.entries(payload ?? {}).map(
    ([key, value]) => sql`${backgroundJobs.payload} ->> ${key} = ${value}`,
  );
}

function backgroundJobAfterCursor(input: ListBackgroundJobsInput) {
  const cursor = input.cursor!;
  const cursorCreatedAt = new Date(cursor.createdAt);
  return input.order === "asc"
    ? or(
        gt(backgroundJobs.createdAt, cursorCreatedAt),
        and(
          eq(backgroundJobs.createdAt, cursorCreatedAt),
          gt(backgroundJobs.id, cursor.id),
        ),
      )!
    : or(
        lt(backgroundJobs.createdAt, cursorCreatedAt),
        and(
          eq(backgroundJobs.createdAt, cursorCreatedAt),
          gt(backgroundJobs.id, cursor.id),
        ),
      )!;
}

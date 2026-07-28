import type {
  ClaimBackgroundJobInput,
  RenewBackgroundJobLeaseInput,
  UpdateBackgroundJobWithLeaseInput,
} from "@romeo/core";
import { and, asc, desc, eq, lt, lte, or, sql } from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import {
  auditLogs,
  backgroundJobs,
  systemSettings,
  usageEvents,
} from "./schema";
import {
  optionalDate,
  optionalIsoString,
  toIsoString,
} from "./repository-mapping";
import type {
  AuditLogRecord,
  AuditOutcomeRecord,
  BackgroundJobRecord,
  BackgroundJobStatusRecord,
  SystemSettingRecord,
  UsageEventRecord,
  UsageSourceTypeRecord,
} from "./operational-records";
import {
  applyWorkerLease,
  readWorkerLease,
  renewWorkerLease,
} from "./operational-worker-lease";

export type * from "./operational-records";

export class PgOperationalRepository {
  constructor(private readonly db: RomeoDatabase) {}

  async getSystemSetting(
    key: string,
  ): Promise<SystemSettingRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, key))
      .limit(1);
    return row === undefined ? undefined : toSystemSettingRecord(row);
  }

  async listSystemSettings(): Promise<SystemSettingRecord[]> {
    const rows = await this.db
      .select()
      .from(systemSettings)
      .orderBy(asc(systemSettings.key));
    return rows.map(toSystemSettingRecord);
  }

  async upsertSystemSetting(
    setting: SystemSettingRecord,
  ): Promise<SystemSettingRecord> {
    const [row] = await this.db
      .insert(systemSettings)
      .values(toSystemSettingInsert(setting))
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: {
          value: setting.value,
          updatedAt: new Date(setting.updatedAt),
        },
      })
      .returning();
    return row === undefined ? setting : toSystemSettingRecord(row);
  }

  async listAuditLogs(orgId: string): Promise<AuditLogRecord[]> {
    const rows = await this.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.orgId, orgId))
      .orderBy(desc(auditLogs.createdAt), asc(auditLogs.id));
    return rows.map(toAuditLogRecord);
  }

  async createAuditLog(log: AuditLogRecord): Promise<AuditLogRecord> {
    const [row] = await this.db
      .insert(auditLogs)
      .values(toAuditLogInsert(log))
      .returning();
    return row === undefined ? log : toAuditLogRecord(row);
  }

  async deleteAuditLogsBefore(orgId: string, before: string): Promise<number> {
    const rows = await this.db
      .delete(auditLogs)
      .where(
        and(
          eq(auditLogs.orgId, orgId),
          lt(auditLogs.createdAt, new Date(before)),
        ),
      )
      .returning({ id: auditLogs.id });
    return rows.length;
  }

  async listUsageEvents(orgId: string): Promise<UsageEventRecord[]> {
    const rows = await this.db
      .select()
      .from(usageEvents)
      .where(eq(usageEvents.orgId, orgId))
      .orderBy(desc(usageEvents.createdAt), asc(usageEvents.id));
    return rows.map(toUsageEventRecord);
  }

  async createUsageEvent(event: UsageEventRecord): Promise<UsageEventRecord> {
    const [row] = await this.db
      .insert(usageEvents)
      .values(toUsageEventInsert(event))
      .returning();
    return row === undefined ? event : toUsageEventRecord(row);
  }

  async updateUsageEvent(event: UsageEventRecord): Promise<UsageEventRecord> {
    const [row] = await this.db
      .update(usageEvents)
      .set(toUsageEventInsert(event))
      .where(eq(usageEvents.id, event.id))
      .returning();
    return row === undefined ? event : toUsageEventRecord(row);
  }

  async listBackgroundJobs(orgId: string): Promise<BackgroundJobRecord[]> {
    const rows = await this.db
      .select()
      .from(backgroundJobs)
      .where(eq(backgroundJobs.orgId, orgId))
      .orderBy(desc(backgroundJobs.createdAt), asc(backgroundJobs.id));
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
    const [candidate] = await this.db
      .select()
      .from(backgroundJobs)
      .where(claimable)
      .orderBy(asc(backgroundJobs.createdAt), asc(backgroundJobs.id))
      .limit(1);
    if (candidate === undefined) return undefined;

    const job = toBackgroundJobRecord(candidate);
    const [row] = await this.db
      .update(backgroundJobs)
      .set({
        payload: applyWorkerLease(job, input, now).payload,
        status: "running",
        updatedAt: nowDate,
      })
      .where(and(eq(backgroundJobs.id, job.id), claimable))
      .returning();
    return row === undefined ? undefined : toBackgroundJobRecord(row);
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

export function toAuditLogRecord(
  row: typeof auditLogs.$inferSelect,
): AuditLogRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    actorId: row.actorId,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    outcome: asAuditOutcome(row.outcome),
    metadata: asJsonRecord(row.metadata),
    createdAt: toIsoString(row.createdAt),
  };
}

export function toUsageEventRecord(
  row: typeof usageEvents.$inferSelect,
): UsageEventRecord {
  const event: UsageEventRecord = {
    id: row.id,
    orgId: row.orgId,
    actorId: row.actorId,
    sourceType: asUsageSourceType(row.sourceType),
    sourceId: row.sourceId,
    metric: row.metric,
    quantity: row.quantity,
    unit: row.unit,
    metadata: asJsonRecord(row.metadata),
    createdAt: toIsoString(row.createdAt),
  };
  const workspaceId = optionalIsoString(row.workspaceId);
  if (workspaceId !== undefined) event.workspaceId = workspaceId;
  return event;
}

export function toBackgroundJobRecord(
  row: typeof backgroundJobs.$inferSelect,
): BackgroundJobRecord {
  const job: BackgroundJobRecord = {
    id: row.id,
    orgId: row.orgId,
    type: row.type,
    status: asBackgroundJobStatus(row.status),
    payload: asJsonRecord(row.payload),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
  const workspaceId = optionalIsoString(row.workspaceId);
  if (workspaceId !== undefined) job.workspaceId = workspaceId;
  const completedAt = optionalIsoString(row.completedAt);
  if (completedAt !== undefined) job.completedAt = completedAt;
  return job;
}

export function toSystemSettingRecord(
  row: typeof systemSettings.$inferSelect,
): SystemSettingRecord {
  return {
    key: row.key,
    value: asJsonRecord(row.value),
    updatedAt: toIsoString(row.updatedAt),
  };
}

function toAuditLogInsert(
  record: AuditLogRecord,
): typeof auditLogs.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    actorId: record.actorId,
    action: record.action,
    resourceType: record.resourceType,
    resourceId: record.resourceId,
    outcome: record.outcome,
    metadata: record.metadata,
    createdAt: new Date(record.createdAt),
  };
}

function toUsageEventInsert(
  record: UsageEventRecord,
): typeof usageEvents.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    workspaceId: record.workspaceId ?? null,
    actorId: record.actorId,
    sourceType: record.sourceType,
    sourceId: record.sourceId,
    metric: record.metric,
    quantity: record.quantity,
    unit: record.unit,
    metadata: record.metadata,
    createdAt: new Date(record.createdAt),
  };
}

function toBackgroundJobInsert(
  record: BackgroundJobRecord,
): typeof backgroundJobs.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    workspaceId: record.workspaceId ?? null,
    type: record.type,
    status: record.status,
    payload: record.payload,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    completedAt: optionalDate(record.completedAt),
  };
}

function toSystemSettingInsert(
  record: SystemSettingRecord,
): typeof systemSettings.$inferInsert {
  return {
    key: record.key,
    value: record.value,
    updatedAt: new Date(record.updatedAt),
  };
}

function claimableBackgroundJobWhere(
  input: ClaimBackgroundJobInput,
  staleBefore: Date,
) {
  const payloadEquals = Object.entries(input.payloadEquals ?? {}).map(
    ([key, value]) => sql`${backgroundJobs.payload} ->> ${key} = ${value}`,
  );
  return and(
    eq(backgroundJobs.orgId, input.orgId),
    eq(backgroundJobs.type, input.type),
    ...payloadEquals,
    or(
      eq(backgroundJobs.status, "queued"),
      and(
        eq(backgroundJobs.status, "running"),
        lte(backgroundJobs.updatedAt, staleBefore),
      ),
    ),
  );
}

function asAuditOutcome(value: string): AuditOutcomeRecord {
  if (value === "failure" || value === "success") return value;
  return "failure";
}

function asUsageSourceType(value: string): UsageSourceTypeRecord {
  if (
    value === "chat" ||
    value === "retrieval" ||
    value === "run" ||
    value === "storage" ||
    value === "tool" ||
    value === "voice"
  ) {
    return value;
  }
  return "storage";
}

function asBackgroundJobStatus(value: string): BackgroundJobStatusRecord {
  if (
    value === "completed" ||
    value === "failed" ||
    value === "queued" ||
    value === "running"
  ) {
    return value;
  }
  return "failed";
}

function asJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return {};
  return value as Record<string, unknown>;
}

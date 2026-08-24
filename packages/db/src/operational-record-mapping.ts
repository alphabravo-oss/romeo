import { backgroundJobs, systemSettings, usageEvents } from "./schema";
import {
  optionalDate,
  optionalIsoString,
  toIsoString,
} from "./repository-mapping";
import type {
  BackgroundJobRecord,
  BackgroundJobStatusRecord,
  SystemSettingRecord,
  UsageEventRecord,
  UsageSourceTypeRecord,
} from "./operational-records";

const globalSettingScope = "__global__";

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
    ...(row.orgId === null ? {} : { orgId: row.orgId }),
    value: asJsonRecord(row.value),
    updatedAt: toIsoString(row.updatedAt),
  };
}

export function toUsageEventInsert(
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

export function toBackgroundJobInsert(
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

export function toSystemSettingInsert(
  record: SystemSettingRecord,
  orgId: string | null,
): typeof systemSettings.$inferInsert {
  return {
    key: record.key,
    scopeOrgId: orgId ?? globalSettingScope,
    orgId: orgId ?? null,
    value: record.value,
    updatedAt: new Date(record.updatedAt),
  };
}

export function assertSettingScope(
  setting: SystemSettingRecord,
  orgId: string | null,
): void {
  if (setting.orgId !== undefined && setting.orgId !== orgId)
    throw new Error("system_setting_scope_mismatch");
}

function asUsageSourceType(value: string): UsageSourceTypeRecord {
  if (
    value === "chat" ||
    value === "retrieval" ||
    value === "run" ||
    value === "storage" ||
    value === "tool" ||
    value === "voice"
  )
    return value;
  return "storage";
}

function asBackgroundJobStatus(value: string): BackgroundJobStatusRecord {
  if (
    value === "completed" ||
    value === "failed" ||
    value === "queued" ||
    value === "running"
  )
    return value;
  return "failed";
}

function asJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return {};
  return value as Record<string, unknown>;
}

import type { AuditLogRecord, AuditOutcomeRecord } from "./operational-records";
import { toIsoString } from "./repository-mapping";
import { auditLogs } from "./schema";

export function toAuditLogRecord(
  row: typeof auditLogs.$inferSelect,
): AuditLogRecord {
  return {
    action: row.action,
    actorId: row.actorId,
    createdAt: toIsoString(row.createdAt),
    id: row.id,
    metadata: asJsonRecord(row.metadata),
    orgId: row.orgId,
    outcome: asAuditOutcome(row.outcome),
    resourceId: row.resourceId,
    resourceType: row.resourceType,
  };
}

export function toAuditLogInsert(
  record: AuditLogRecord,
): typeof auditLogs.$inferInsert {
  return {
    action: record.action,
    actorId: record.actorId,
    createdAt: new Date(record.createdAt),
    id: record.id,
    metadata: record.metadata,
    orgId: record.orgId,
    outcome: record.outcome,
    resourceId: record.resourceId,
    resourceType: record.resourceType,
  };
}

function asAuditOutcome(value: string): AuditOutcomeRecord {
  return value === "failure" || value === "success" ? value : "failure";
}

function asJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return {};
  return value as Record<string, unknown>;
}

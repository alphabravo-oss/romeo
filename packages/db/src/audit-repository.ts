import {
  assertValidAuditLog,
  type AuditLogQueryResult,
  type QueryAuditLogsInput,
} from "@romeo/core";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  like,
  lt,
  lte,
  notInArray,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import type { AuditLogRecord, AuditOutcomeRecord } from "./operational-records";
import { toIsoString } from "./repository-mapping";
import { auditLogs } from "./schema";

const maxAuditQueryLimit = 200;
const auditNoiseActions: string[] = [
  "billing.entitlements_reconciled",
  "billing.external_event_synced",
  "chat.temporary.cleanup",
  "chat.temporary.cleanup.worker",
  "knowledge.embedding.index",
  "model.request",
  "provider.models.sync",
  "tool.connector.auth.check",
  "worker.enqueue",
];
const auditSortColumns = { createdAt: auditLogs.createdAt } as const;

export class PgAuditRepository {
  constructor(protected readonly db: RomeoDatabase) {}

  async listAuditLogs(orgId: string): Promise<AuditLogRecord[]> {
    const rows = await this.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.orgId, orgId))
      .orderBy(desc(auditLogs.createdAt), asc(auditLogs.id));
    return rows.map(toAuditLogRecord);
  }

  async queryAuditLogs(
    input: QueryAuditLogsInput,
  ): Promise<AuditLogQueryResult> {
    const limit = normalizeAuditQueryLimit(input.limit);
    const column = auditSortColumns[input.sort.field];
    const direction = input.sort.direction;
    const conditions: Array<SQL | undefined> = [
      eq(auditLogs.orgId, input.orgId),
      input.filter.action === undefined
        ? undefined
        : eq(auditLogs.action, input.filter.action),
      input.filter.actorId === undefined
        ? undefined
        : eq(auditLogs.actorId, input.filter.actorId),
      input.filter.category === undefined
        ? undefined
        : sql`${auditCategoryExpression()} = ${input.filter.category}`,
      input.filter.from === undefined
        ? undefined
        : gte(auditLogs.createdAt, new Date(input.filter.from)),
      input.filter.outcome === undefined
        ? undefined
        : eq(auditLogs.outcome, input.filter.outcome),
      input.filter.resourceId === undefined
        ? undefined
        : eq(auditLogs.resourceId, input.filter.resourceId),
      input.filter.resourceType === undefined
        ? undefined
        : eq(auditLogs.resourceType, input.filter.resourceType),
      input.filter.to === undefined
        ? undefined
        : lte(auditLogs.createdAt, new Date(input.filter.to)),
      noisePredicate(input),
      searchPredicate(input.search),
      positionPredicate(input),
    ];
    const rows = await this.db
      .select()
      .from(auditLogs)
      .where(and(...conditions))
      .orderBy(
        direction === "asc" ? asc(column) : desc(column),
        direction === "asc" ? asc(auditLogs.id) : desc(auditLogs.id),
      )
      .limit(limit + 1);
    return {
      hasMore: rows.length > limit,
      items: rows.slice(0, limit).map(toAuditLogRecord),
    };
  }

  async createAuditLog(log: AuditLogRecord): Promise<AuditLogRecord> {
    assertValidAuditLog(log);
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
}

function normalizeAuditQueryLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) return 1;
  return Math.min(value, maxAuditQueryLimit);
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

function positionPredicate(input: QueryAuditLogsInput): SQL | undefined {
  if (input.position === undefined) return undefined;
  const createdAt = new Date(input.position.createdAt);
  if (input.sort.direction === "asc")
    return or(
      gt(auditLogs.createdAt, createdAt),
      and(
        eq(auditLogs.createdAt, createdAt),
        gt(auditLogs.id, input.position.id),
      ),
    );
  return or(
    lt(auditLogs.createdAt, createdAt),
    and(
      eq(auditLogs.createdAt, createdAt),
      lt(auditLogs.id, input.position.id),
    ),
  );
}

function noisePredicate(input: QueryAuditLogsInput): SQL | undefined {
  if (
    input.filter.includeNoise === true ||
    input.filter.action !== undefined ||
    input.filter.category === "system"
  )
    return undefined;
  return or(
    eq(auditLogs.outcome, "failure"),
    notInArray(auditLogs.action, auditNoiseActions),
  );
}

function searchPredicate(search: string | undefined): SQL | undefined {
  if (search === undefined) return undefined;
  return and(
    // The trigram expression is a candidate prefilter. Keep the individual
    // predicates below as the source of truth so delimiter-spanning input and
    // literal LIKE wildcard characters retain the legacy search semantics.
    sql`${auditSearchDocument()} like ('%' || lower(${escapedLikeLiteral(search)}) || '%')`,
    or(
      containsLiteral(auditLogs.action, search),
      containsLiteral(auditLogs.actorId, search),
      containsLiteral(auditLogs.resourceType, search),
      containsLiteral(auditLogs.resourceId, search),
    ),
  );
}

function auditSearchDocument(): SQL {
  return sql`lower(${auditLogs.action} || chr(31) || ${auditLogs.actorId} || chr(31) || ${auditLogs.resourceType} || chr(31) || ${auditLogs.resourceId})`;
}

function escapedLikeLiteral(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}

function containsLiteral(column: SQLWrapper, value: string): SQL {
  return sql`position(lower(${value}) in lower(${column})) > 0`;
}

function auditCategoryExpression(): SQL {
  return sql`case
    when ${inArray(auditLogs.action, auditNoiseActions)} then 'system'
    when ${securityCategoryPredicate()} then 'security'
    when ${accessCategoryPredicate()} then 'access'
    when ${dataCategoryPredicate()} then 'data'
    when ${chatCategoryPredicate()} then 'chat'
    when ${runCategoryPredicate()} then 'run'
    when ${like(auditLogs.action, "worker.%")} then 'system'
    else 'admin'
  end`;
}

function securityCategoryPredicate(): SQL {
  return or(
    like(auditLogs.action, "local_auth.%"),
    like(auditLogs.action, "auth.%"),
    like(auditLogs.action, "support.%"),
    like(auditLogs.action, "scim.%"),
    like(auditLogs.action, "directory_sync.%"),
    like(auditLogs.action, "%impersonat%"),
  )!;
}

function accessCategoryPredicate(): SQL {
  return or(
    like(auditLogs.action, "%share%"),
    like(auditLogs.action, "%grant%"),
    like(auditLogs.action, "%favorite%"),
    like(auditLogs.action, "group.%"),
    like(auditLogs.action, "api_key.%"),
    like(auditLogs.action, "service_account.%"),
  )!;
}

function dataCategoryPredicate(): SQL {
  return or(
    like(auditLogs.action, "knowledge.%"),
    like(auditLogs.action, "file.%"),
    like(auditLogs.action, "connector.%"),
    like(auditLogs.action, "folder.%"),
  )!;
}

function chatCategoryPredicate(): SQL {
  return or(
    like(auditLogs.action, "chat.%"),
    like(auditLogs.action, "chat_experience.%"),
  )!;
}

function runCategoryPredicate(): SQL {
  return or(
    like(auditLogs.action, "run.%"),
    like(auditLogs.action, "tool.%"),
    like(auditLogs.action, "eval.%"),
    like(auditLogs.action, "workflow.%"),
    like(auditLogs.action, "voice.%"),
    like(auditLogs.action, "web_search.query%"),
    like(auditLogs.action, "web_url.%"),
  )!;
}

function asAuditOutcome(value: string): AuditOutcomeRecord {
  return value === "failure" || value === "success" ? value : "failure";
}

function asJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return {};
  return value as Record<string, unknown>;
}

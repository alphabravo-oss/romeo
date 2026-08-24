import {
  assertValidAuditLog,
  type AuditExportAttempt,
  type AuditExportDestination,
  type AuditExportIdempotencyReceipt,
  type AuditExportJob,
  type AuditIntegrityCheckpoint,
  type AuditIntegrityRecord,
  type AuditLogQueryResult,
  type AuditRetentionExportGate,
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

import { PgAuditExportRepository } from "./audit-export-repository";
import {
  appendAuditIntegrityRecord,
  lockAuditChain,
  PgAuditIntegrityRepository,
} from "./audit-integrity-repository";
import { toAuditLogInsert, toAuditLogRecord } from "./audit-log-record-mapping";
import type { RomeoDatabase } from "./client";
import type { AuditLogRecord } from "./operational-records";
import { auditLogs } from "./schema";

export { toAuditLogRecord } from "./audit-log-record-mapping";

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
  private readonly exports: PgAuditExportRepository;
  private readonly integrity: PgAuditIntegrityRepository;

  constructor(protected readonly db: RomeoDatabase) {
    this.exports = new PgAuditExportRepository(db);
    this.integrity = new PgAuditIntegrityRepository(db);
  }

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
    return this.db.transaction(async (tx) => {
      const database = tx as unknown as RomeoDatabase;
      await lockAuditChain(database, log.orgId);
      const [row] = await database
        .insert(auditLogs)
        .values(toAuditLogInsert(log))
        .returning();
      await appendAuditIntegrityRecord(database, log);
      return row === undefined ? log : toAuditLogRecord(row);
    });
  }

  ensureAuditIntegrityRecords(orgId: string): Promise<number> {
    return this.integrity.ensure(orgId);
  }

  async deleteAuditLogsBefore(orgId: string, before: string): Promise<number> {
    return this.db.transaction(async (tx) => {
      const database = tx as unknown as RomeoDatabase;
      const gate = await new PgAuditExportRepository(database).retentionGate(
        orgId,
        before,
      );
      if (!gate.deletable)
        throw new Error("audit_retention_export_confirmation_required");
      await tx.execute(
        sql`select set_config('romeo.audit_integrity_mutation', 'authorized', true)`,
      );
      const rows = await tx
        .delete(auditLogs)
        .where(
          and(
            eq(auditLogs.orgId, orgId),
            lt(auditLogs.createdAt, new Date(before)),
          ),
        )
        .returning({ id: auditLogs.id });
      return rows.length;
    });
  }

  listAuditIntegrityRecords(orgId: string): Promise<AuditIntegrityRecord[]> {
    return this.integrity.listRecords(orgId);
  }

  listAuditIntegrityCheckpoints(
    orgId: string,
  ): Promise<AuditIntegrityCheckpoint[]> {
    return this.integrity.listCheckpoints(orgId);
  }

  getAuditIntegrityCheckpoint(orgId: string, checkpointId: string) {
    return this.integrity.getCheckpoint(orgId, checkpointId);
  }

  getAuditIntegrityCheckpointByHash(orgId: string, checkpointHash: string) {
    return this.integrity.getCheckpointByHash(orgId, checkpointHash);
  }

  createAuditIntegrityCheckpoint(checkpoint: AuditIntegrityCheckpoint) {
    return this.integrity.createCheckpoint(checkpoint);
  }

  getAuditExportDestination(
    orgId: string,
    kind: AuditExportDestination["kind"],
  ) {
    return this.exports.getDestination(orgId, kind);
  }

  upsertAuditExportDestination(destination: AuditExportDestination) {
    return this.exports.upsertDestination(destination);
  }

  getAuditExportJob(orgId: string, jobId: string) {
    return this.exports.getJob(orgId, jobId);
  }

  listAuditExportJobs(orgId: string, destinationId?: string) {
    return this.exports.listJobs(orgId, destinationId);
  }

  getAuditExportJobByIdempotencyHash(
    orgId: string,
    idempotencyKeyHash: string,
  ) {
    return this.exports.getJobByIdempotencyHash(orgId, idempotencyKeyHash);
  }

  createAuditExportJob(job: AuditExportJob) {
    return this.exports.createJob(job);
  }

  claimAuditExportJob(input: {
    jobId: string;
    leaseSeconds: number;
    leaseToken: string;
    now: string;
    orgId: string;
  }) {
    return this.exports.claimJob(input);
  }

  completeAuditExportAttempt(input: {
    attempt: AuditExportAttempt;
    job: AuditExportJob;
    leaseToken: string;
  }) {
    return this.exports.completeAttempt(input);
  }

  listAuditExportAttempts(orgId: string, jobId: string) {
    return this.exports.listAttempts(orgId, jobId);
  }

  getAuditExportIdempotencyReceipt(orgId: string, idempotencyKeyHash: string) {
    return this.exports.getReceipt(orgId, idempotencyKeyHash);
  }

  createAuditExportIdempotencyReceipt(receipt: AuditExportIdempotencyReceipt) {
    return this.exports.createReceipt(receipt);
  }

  auditRetentionExportGate(
    orgId: string,
    before: string,
  ): Promise<AuditRetentionExportGate> {
    return this.exports.retentionGate(orgId, before);
  }
}

function normalizeAuditQueryLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) return 1;
  return Math.min(value, maxAuditQueryLimit);
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

import {
  createAuditIntegrityRecord,
  type AuditIntegrityCheckpoint,
  type AuditIntegrityRecord,
} from "@romeo/core";
import { and, asc, eq, sql } from "drizzle-orm";

import { toAuditLogRecord } from "./audit-log-record-mapping";
import type { RomeoDatabase } from "./client";
import type { AuditLogRecord } from "./operational-records";
import { toIsoString } from "./repository-mapping";
import {
  auditIntegrityCheckpoints,
  auditIntegrityRecords,
  auditIntegrityTenantHeads,
  auditLogs,
} from "./schema";

export class PgAuditIntegrityRepository {
  constructor(private readonly db: RomeoDatabase) {}

  async ensure(orgId: string): Promise<number> {
    return this.db.transaction(async (tx) => {
      const database = tx as unknown as RomeoDatabase;
      await lockAuditChain(database, orgId);
      const [logs, records] = await Promise.all([
        database
          .select()
          .from(auditLogs)
          .where(eq(auditLogs.orgId, orgId))
          .orderBy(asc(auditLogs.createdAt), asc(auditLogs.id)),
        database
          .select({ auditEventId: auditIntegrityRecords.auditEventId })
          .from(auditIntegrityRecords)
          .where(eq(auditIntegrityRecords.orgId, orgId)),
      ]);
      const recorded = new Set(records.map((record) => record.auditEventId));
      const missing = logs.filter((log) => !recorded.has(log.id));
      for (const row of missing)
        await appendAuditIntegrityRecord(database, toAuditLogRecord(row));
      return missing.length;
    });
  }

  async listRecords(orgId: string): Promise<AuditIntegrityRecord[]> {
    const rows = await this.db
      .select()
      .from(auditIntegrityRecords)
      .where(eq(auditIntegrityRecords.orgId, orgId))
      .orderBy(asc(auditIntegrityRecords.sequence));
    return rows.map(toAuditIntegrityRecord);
  }

  async listCheckpoints(orgId: string): Promise<AuditIntegrityCheckpoint[]> {
    const rows = await this.db
      .select()
      .from(auditIntegrityCheckpoints)
      .where(eq(auditIntegrityCheckpoints.orgId, orgId))
      .orderBy(
        asc(auditIntegrityCheckpoints.fromSequence),
        asc(auditIntegrityCheckpoints.id),
      );
    return rows.map(toAuditIntegrityCheckpoint);
  }

  async getCheckpoint(
    orgId: string,
    checkpointId: string,
  ): Promise<AuditIntegrityCheckpoint | undefined> {
    const [row] = await this.db
      .select()
      .from(auditIntegrityCheckpoints)
      .where(
        and(
          eq(auditIntegrityCheckpoints.orgId, orgId),
          eq(auditIntegrityCheckpoints.id, checkpointId),
        ),
      )
      .limit(1);
    return row === undefined ? undefined : toAuditIntegrityCheckpoint(row);
  }

  async getCheckpointByHash(
    orgId: string,
    checkpointHash: string,
  ): Promise<AuditIntegrityCheckpoint | undefined> {
    const [row] = await this.db
      .select()
      .from(auditIntegrityCheckpoints)
      .where(
        and(
          eq(auditIntegrityCheckpoints.orgId, orgId),
          eq(auditIntegrityCheckpoints.checkpointHash, checkpointHash),
        ),
      )
      .limit(1);
    return row === undefined ? undefined : toAuditIntegrityCheckpoint(row);
  }

  async createCheckpoint(
    checkpoint: AuditIntegrityCheckpoint,
  ): Promise<AuditIntegrityCheckpoint> {
    const [row] = await this.db
      .insert(auditIntegrityCheckpoints)
      .values(toAuditIntegrityCheckpointInsert(checkpoint))
      .returning();
    return row === undefined ? checkpoint : toAuditIntegrityCheckpoint(row);
  }
}

export function lockAuditChain(database: RomeoDatabase, orgId: string) {
  return database.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${orgId}, 41004))`,
  );
}

export async function appendAuditIntegrityRecord(
  database: RomeoDatabase,
  log: AuditLogRecord,
): Promise<AuditIntegrityRecord> {
  const [head] = await database
    .select()
    .from(auditIntegrityTenantHeads)
    .where(eq(auditIntegrityTenantHeads.orgId, log.orgId))
    .limit(1);
  const record = createAuditIntegrityRecord({
    log,
    sequence: (head?.lastSequence ?? 0) + 1,
    ...(head === undefined ? {} : { previousHash: head.lastRecordHash }),
  });
  await database
    .insert(auditIntegrityRecords)
    .values(toAuditIntegrityRecordInsert(record));
  await database
    .insert(auditIntegrityTenantHeads)
    .values({
      lastRecordHash: record.recordHash,
      lastSequence: record.sequence,
      orgId: record.orgId,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: auditIntegrityTenantHeads.orgId,
      set: {
        lastRecordHash: record.recordHash,
        lastSequence: record.sequence,
        updatedAt: new Date(),
      },
    });
  return record;
}

function toAuditIntegrityRecord(
  row: typeof auditIntegrityRecords.$inferSelect,
): AuditIntegrityRecord {
  return {
    auditEventId: row.auditEventId,
    canonicalPayload: row.canonicalPayload,
    createdAt: toIsoString(row.createdAt),
    id: row.id,
    orgId: row.orgId,
    payloadHash: row.payloadHash,
    previousHash: row.previousHash,
    recordHash: row.recordHash,
    sequence: row.sequence,
  };
}

function toAuditIntegrityRecordInsert(
  record: AuditIntegrityRecord,
): typeof auditIntegrityRecords.$inferInsert {
  return {
    auditEventId: record.auditEventId,
    canonicalPayload: record.canonicalPayload,
    createdAt: new Date(record.createdAt),
    id: record.id,
    orgId: record.orgId,
    payloadHash: record.payloadHash,
    previousHash: record.previousHash,
    recordHash: record.recordHash,
    sequence: record.sequence,
  };
}

function toAuditIntegrityCheckpoint(
  row: typeof auditIntegrityCheckpoints.$inferSelect,
): AuditIntegrityCheckpoint {
  return {
    algorithm: asCheckpointAlgorithm(row.algorithm),
    checkpointHash: row.checkpointHash,
    createdAt: toIsoString(row.createdAt),
    firstRecordHash: row.firstRecordHash,
    fromSequence: row.fromSequence,
    id: row.id,
    keyVersion: row.keyVersion,
    lastRecordHash: row.lastRecordHash,
    orgId: row.orgId,
    previousCheckpointHash: row.previousCheckpointHash,
    recordCount: row.recordCount,
    rootHash: row.rootHash,
    schema: asCheckpointSchema(row.schema),
    signature: row.signature,
    toSequence: row.toSequence,
  };
}

function toAuditIntegrityCheckpointInsert(
  checkpoint: AuditIntegrityCheckpoint,
): typeof auditIntegrityCheckpoints.$inferInsert {
  return {
    algorithm: checkpoint.algorithm,
    checkpointHash: checkpoint.checkpointHash,
    createdAt: new Date(checkpoint.createdAt),
    firstRecordHash: checkpoint.firstRecordHash,
    fromSequence: checkpoint.fromSequence,
    id: checkpoint.id,
    keyVersion: checkpoint.keyVersion,
    lastRecordHash: checkpoint.lastRecordHash,
    orgId: checkpoint.orgId,
    previousCheckpointHash: checkpoint.previousCheckpointHash,
    recordCount: checkpoint.recordCount,
    rootHash: checkpoint.rootHash,
    schema: checkpoint.schema,
    signature: checkpoint.signature,
    toSequence: checkpoint.toSequence,
  };
}

function asCheckpointAlgorithm(value: string): "hmac-sha256" {
  if (value !== "hmac-sha256")
    throw new TypeError("Invalid audit checkpoint signature algorithm.");
  return value;
}

function asCheckpointSchema(value: string): AuditIntegrityCheckpoint["schema"] {
  if (value !== "romeo.audit-integrity-checkpoint.v1")
    throw new TypeError("Invalid audit checkpoint schema.");
  return value;
}

import { and, asc, desc, eq, gt, isNull, lte, ne, or } from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import { dataConnectors, dataConnectorSyncs } from "./schema";
import {
  asStringArray,
  optionalDate,
  optionalIsoString,
  toIsoString,
} from "./repository-mapping";

export type DataConnectorTypeRecord =
  | "github"
  | "local_import"
  | "rss"
  | "s3"
  | "website";
export type DataConnectorStatusRecord = "active" | "disabled";
export type DataConnectorSyncStatusRecord = "completed" | "failed" | "running";

export interface DataConnectorRecord {
  id: string;
  orgId: string;
  workspaceId: string;
  knowledgeBaseId: string;
  type: DataConnectorTypeRecord;
  name: string;
  config: Record<string, unknown>;
  status: DataConnectorStatusRecord;
  syncIntervalMinutes?: number;
  nextSyncAt?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  lastSyncAt?: string;
  syncLease?: {
    attempt: number;
    expiresAt: string;
    fencingToken: number;
    owner: string;
    token: string;
  };
}

export interface DataConnectorSyncRecord {
  id: string;
  orgId: string;
  workspaceId: string;
  knowledgeBaseId: string;
  connectorId: string;
  status: DataConnectorSyncStatusRecord;
  createdBy: string;
  itemCount: number;
  sourceIds: string[];
  summary: Record<string, unknown>;
  errorCode?: string;
  startedAt: string;
  completedAt?: string;
  fencingToken?: number;
  leaseToken?: string;
}

export class PgDataConnectorRepository {
  constructor(private readonly db: RomeoDatabase) {}

  async listDataConnectors(
    orgId: string,
    workspaceId?: string,
  ): Promise<DataConnectorRecord[]> {
    const rows = await this.db
      .select()
      .from(dataConnectors)
      .where(
        workspaceId === undefined
          ? eq(dataConnectors.orgId, orgId)
          : and(
              eq(dataConnectors.orgId, orgId),
              eq(dataConnectors.workspaceId, workspaceId),
            ),
      )
      .orderBy(desc(dataConnectors.createdAt), asc(dataConnectors.id));
    return rows.map(toDataConnectorRecord);
  }

  async getDataConnector(
    connectorId: string,
  ): Promise<DataConnectorRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(dataConnectors)
      .where(eq(dataConnectors.id, connectorId))
      .limit(1);
    return row === undefined ? undefined : toDataConnectorRecord(row);
  }

  async createDataConnector(
    connector: DataConnectorRecord,
  ): Promise<DataConnectorRecord> {
    const [row] = await this.db
      .insert(dataConnectors)
      .values(toDataConnectorInsert(connector))
      .returning();
    return row === undefined ? connector : toDataConnectorRecord(row);
  }

  async updateDataConnector(
    connector: DataConnectorRecord,
  ): Promise<DataConnectorRecord> {
    const [row] = await this.db
      .update(dataConnectors)
      .set({
        config: connector.config,
        knowledgeBaseId: connector.knowledgeBaseId,
        lastSyncAt: optionalDate(connector.lastSyncAt),
        name: connector.name,
        nextSyncAt: optionalDate(connector.nextSyncAt),
        status: connector.status,
        syncIntervalMinutes: connector.syncIntervalMinutes ?? null,
        type: connector.type,
        updatedAt: new Date(connector.updatedAt),
        workspaceId: connector.workspaceId,
      })
      .where(eq(dataConnectors.id, connector.id))
      .returning();
    return row === undefined ? connector : toDataConnectorRecord(row);
  }

  async claimDataConnectorSync(input: {
    connectorId?: string;
    leaseExpiresAt: string;
    leaseOwner: string;
    leaseToken: string;
    now: string;
    orgId: string;
  }): Promise<DataConnectorRecord | undefined> {
    return this.db.transaction(async (transaction) => {
      const now = new Date(input.now);
      const [candidate] = await transaction
        .select()
        .from(dataConnectors)
        .where(
          and(
            eq(dataConnectors.orgId, input.orgId),
            eq(dataConnectors.status, "active"),
            input.connectorId === undefined
              ? and(
                  ne(dataConnectors.type, "local_import"),
                  lte(dataConnectors.nextSyncAt, now),
                )
              : eq(dataConnectors.id, input.connectorId),
            or(
              isNull(dataConnectors.syncLeaseExpiresAt),
              lte(dataConnectors.syncLeaseExpiresAt, now),
            ),
          ),
        )
        .orderBy(
          asc(dataConnectors.nextSyncAt),
          asc(dataConnectors.updatedAt),
          asc(dataConnectors.id),
        )
        .limit(1)
        .for("update", { skipLocked: true });
      if (candidate === undefined) return undefined;
      const [claimed] = await transaction
        .update(dataConnectors)
        .set({
          syncAttempts: candidate.syncAttempts + 1,
          syncFence: candidate.syncFence + 1,
          syncLeaseExpiresAt: new Date(input.leaseExpiresAt),
          syncLeaseOwner: input.leaseOwner,
          syncLeaseToken: input.leaseToken,
          updatedAt: now,
        })
        .where(
          and(
            eq(dataConnectors.id, candidate.id),
            eq(dataConnectors.syncFence, candidate.syncFence),
          ),
        )
        .returning();
      return claimed === undefined ? undefined : toDataConnectorRecord(claimed);
    });
  }

  async renewDataConnectorSyncLease(input: {
    connectorId: string;
    fencingToken: number;
    leaseExpiresAt: string;
    leaseOwner: string;
    leaseToken: string;
    now: string;
  }): Promise<DataConnectorRecord | undefined> {
    const now = new Date(input.now);
    const [row] = await this.db
      .update(dataConnectors)
      .set({
        syncLeaseExpiresAt: new Date(input.leaseExpiresAt),
        updatedAt: now,
      })
      .where(
        and(
          eq(dataConnectors.id, input.connectorId),
          eq(dataConnectors.syncFence, input.fencingToken),
          eq(dataConnectors.syncLeaseOwner, input.leaseOwner),
          eq(dataConnectors.syncLeaseToken, input.leaseToken),
          gt(dataConnectors.syncLeaseExpiresAt, now),
        ),
      )
      .returning();
    return row === undefined ? undefined : toDataConnectorRecord(row);
  }

  async finishDataConnectorSync(input: {
    connector: DataConnectorRecord;
    fencingToken: number;
    leaseOwner: string;
    leaseToken: string;
    now: string;
    sync: DataConnectorSyncRecord;
  }): Promise<DataConnectorSyncRecord | undefined> {
    try {
      return await this.db.transaction(async (transaction) => {
        const now = new Date(input.now);
        const [connector] = await transaction
          .update(dataConnectors)
          .set({
            config: input.connector.config,
            lastSyncAt: optionalDate(input.connector.lastSyncAt),
            nextSyncAt: optionalDate(input.connector.nextSyncAt),
            syncIntervalMinutes: input.connector.syncIntervalMinutes ?? null,
            syncLeaseExpiresAt: null,
            syncLeaseOwner: null,
            syncLeaseToken: null,
            updatedAt: new Date(input.connector.updatedAt),
          })
          .where(
            and(
              eq(dataConnectors.id, input.connector.id),
              eq(dataConnectors.syncFence, input.fencingToken),
              eq(dataConnectors.syncLeaseOwner, input.leaseOwner),
              eq(dataConnectors.syncLeaseToken, input.leaseToken),
              gt(dataConnectors.syncLeaseExpiresAt, now),
            ),
          )
          .returning({ id: dataConnectors.id });
        if (connector === undefined) throw new WorkLeaseLostError();
        const [sync] = await transaction
          .update(dataConnectorSyncs)
          .set({
            completedAt: optionalDate(input.sync.completedAt),
            errorCode: input.sync.errorCode ?? null,
            itemCount: input.sync.itemCount,
            sourceIds: input.sync.sourceIds,
            status: input.sync.status,
            summary: input.sync.summary,
          })
          .where(
            and(
              eq(dataConnectorSyncs.id, input.sync.id),
              eq(dataConnectorSyncs.connectorId, input.connector.id),
              eq(dataConnectorSyncs.fencingToken, input.fencingToken),
              eq(dataConnectorSyncs.leaseToken, input.leaseToken),
            ),
          )
          .returning();
        if (sync === undefined) throw new WorkLeaseLostError();
        return toDataConnectorSyncRecord(sync);
      });
    } catch (error) {
      if (error instanceof WorkLeaseLostError) return undefined;
      throw error;
    }
  }

  async listDataConnectorSyncs(
    orgId: string,
    connectorId?: string,
  ): Promise<DataConnectorSyncRecord[]> {
    const rows = await this.db
      .select()
      .from(dataConnectorSyncs)
      .where(
        connectorId === undefined
          ? eq(dataConnectorSyncs.orgId, orgId)
          : and(
              eq(dataConnectorSyncs.orgId, orgId),
              eq(dataConnectorSyncs.connectorId, connectorId),
            ),
      )
      .orderBy(desc(dataConnectorSyncs.startedAt), asc(dataConnectorSyncs.id));
    return rows.map(toDataConnectorSyncRecord);
  }

  async createDataConnectorSync(
    sync: DataConnectorSyncRecord,
  ): Promise<DataConnectorSyncRecord> {
    const [row] = await this.db
      .insert(dataConnectorSyncs)
      .values(toDataConnectorSyncInsert(sync))
      .returning();
    return row === undefined ? sync : toDataConnectorSyncRecord(row);
  }

  async updateDataConnectorSync(
    sync: DataConnectorSyncRecord,
  ): Promise<DataConnectorSyncRecord> {
    const [row] = await this.db
      .update(dataConnectorSyncs)
      .set({
        completedAt: optionalDate(sync.completedAt),
        errorCode: sync.errorCode ?? null,
        itemCount: sync.itemCount,
        sourceIds: sync.sourceIds,
        status: sync.status,
        summary: sync.summary,
      })
      .where(eq(dataConnectorSyncs.id, sync.id))
      .returning();
    return row === undefined ? sync : toDataConnectorSyncRecord(row);
  }
}

export function toDataConnectorRecord(
  row: typeof dataConnectors.$inferSelect,
): DataConnectorRecord {
  const connector: DataConnectorRecord = {
    id: row.id,
    orgId: row.orgId,
    workspaceId: row.workspaceId,
    knowledgeBaseId: row.knowledgeBaseId,
    type: asDataConnectorType(row.type),
    name: row.name,
    config: asJsonRecord(row.config),
    status: asDataConnectorStatus(row.status),
    createdBy: row.createdBy,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
  if (row.syncIntervalMinutes !== null)
    connector.syncIntervalMinutes = row.syncIntervalMinutes;
  const nextSyncAt = optionalIsoString(row.nextSyncAt);
  if (nextSyncAt !== undefined) connector.nextSyncAt = nextSyncAt;
  const lastSyncAt = optionalIsoString(row.lastSyncAt);
  if (lastSyncAt !== undefined) connector.lastSyncAt = lastSyncAt;
  if (
    row.syncLeaseOwner !== null &&
    row.syncLeaseToken !== null &&
    row.syncLeaseExpiresAt !== null
  ) {
    connector.syncLease = {
      attempt: row.syncAttempts,
      expiresAt: row.syncLeaseExpiresAt.toISOString(),
      fencingToken: row.syncFence,
      owner: row.syncLeaseOwner,
      token: row.syncLeaseToken,
    };
  }
  return connector;
}

export function toDataConnectorSyncRecord(
  row: typeof dataConnectorSyncs.$inferSelect,
): DataConnectorSyncRecord {
  const sync: DataConnectorSyncRecord = {
    id: row.id,
    orgId: row.orgId,
    workspaceId: row.workspaceId,
    knowledgeBaseId: row.knowledgeBaseId,
    connectorId: row.connectorId,
    status: asDataConnectorSyncStatus(row.status),
    createdBy: row.createdBy,
    itemCount: row.itemCount,
    sourceIds: asStringArray(row.sourceIds),
    summary: asJsonRecord(row.summary),
    startedAt: toIsoString(row.startedAt),
  };
  const errorCode = optionalIsoString(row.errorCode);
  if (errorCode !== undefined) sync.errorCode = errorCode;
  const completedAt = optionalIsoString(row.completedAt);
  if (completedAt !== undefined) sync.completedAt = completedAt;
  if (row.fencingToken !== null) sync.fencingToken = row.fencingToken;
  if (row.leaseToken !== null) sync.leaseToken = row.leaseToken;
  return sync;
}

function toDataConnectorInsert(
  record: DataConnectorRecord,
): typeof dataConnectors.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    workspaceId: record.workspaceId,
    knowledgeBaseId: record.knowledgeBaseId,
    type: record.type,
    name: record.name,
    config: record.config,
    status: record.status,
    syncIntervalMinutes: record.syncIntervalMinutes ?? null,
    nextSyncAt: optionalDate(record.nextSyncAt),
    createdBy: record.createdBy,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    lastSyncAt: optionalDate(record.lastSyncAt),
  };
}

function toDataConnectorSyncInsert(
  record: DataConnectorSyncRecord,
): typeof dataConnectorSyncs.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    workspaceId: record.workspaceId,
    knowledgeBaseId: record.knowledgeBaseId,
    connectorId: record.connectorId,
    status: record.status,
    createdBy: record.createdBy,
    itemCount: record.itemCount,
    sourceIds: record.sourceIds,
    summary: record.summary,
    errorCode: record.errorCode ?? null,
    startedAt: new Date(record.startedAt),
    completedAt: optionalDate(record.completedAt),
    fencingToken: record.fencingToken ?? null,
    leaseToken: record.leaseToken ?? null,
  };
}

class WorkLeaseLostError extends Error {}

function asDataConnectorType(value: string): DataConnectorTypeRecord {
  if (
    value === "github" ||
    value === "local_import" ||
    value === "rss" ||
    value === "s3" ||
    value === "website"
  ) {
    return value;
  }
  return "local_import";
}

function asDataConnectorStatus(value: string): DataConnectorStatusRecord {
  if (value === "active" || value === "disabled") return value;
  return "disabled";
}

function asDataConnectorSyncStatus(
  value: string,
): DataConnectorSyncStatusRecord {
  if (value === "completed" || value === "failed" || value === "running")
    return value;
  return "failed";
}

function asJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return {};
  return value as Record<string, unknown>;
}

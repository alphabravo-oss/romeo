import { asc, desc, eq } from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import {
  knowledgeBases,
  knowledgeChunkEmbeddings,
  knowledgeChunks,
  knowledgeSources,
} from "./schema";
import {
  optionalDate,
  optionalIsoString,
  toIsoString,
} from "./repository-mapping";

export interface KnowledgeBaseRecord {
  id: string;
  orgId: string;
  workspaceId: string;
  name: string;
  description?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type KnowledgeSourceStatusRecord = "failed" | "indexed" | "pending";

export interface KnowledgeSourceRecord {
  id: string;
  knowledgeBaseId: string;
  orgId: string;
  workspaceId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  status: KnowledgeSourceStatusRecord;
  objectKey?: string;
  metadata: Record<string, unknown>;
  chunkCount?: number;
  contentHash?: string;
  indexedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeChunkRecord {
  id: string;
  knowledgeBaseId: string;
  sourceId: string;
  orgId: string;
  workspaceId: string;
  sequence: number;
  content: string;
  tokenCount: number;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export class PgKnowledgeRepository {
  constructor(private readonly db: RomeoDatabase) {}

  async listKnowledgeBases(
    workspaceId: string,
  ): Promise<KnowledgeBaseRecord[]> {
    const rows = await this.db
      .select()
      .from(knowledgeBases)
      .where(eq(knowledgeBases.workspaceId, workspaceId))
      .orderBy(asc(knowledgeBases.name), asc(knowledgeBases.id));
    return rows.map(toKnowledgeBaseRecord);
  }

  async createKnowledgeBase(
    knowledgeBase: KnowledgeBaseRecord,
  ): Promise<KnowledgeBaseRecord> {
    const [row] = await this.db
      .insert(knowledgeBases)
      .values(toKnowledgeBaseInsert(knowledgeBase))
      .returning();
    return row === undefined ? knowledgeBase : toKnowledgeBaseRecord(row);
  }

  async updateKnowledgeBase(
    knowledgeBase: KnowledgeBaseRecord,
  ): Promise<KnowledgeBaseRecord> {
    const [row] = await this.db
      .update(knowledgeBases)
      .set(toKnowledgeBaseInsert(knowledgeBase))
      .where(eq(knowledgeBases.id, knowledgeBase.id))
      .returning();
    return row === undefined ? knowledgeBase : toKnowledgeBaseRecord(row);
  }

  async getKnowledgeBase(
    knowledgeBaseId: string,
  ): Promise<KnowledgeBaseRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(knowledgeBases)
      .where(eq(knowledgeBases.id, knowledgeBaseId))
      .limit(1);
    return row === undefined ? undefined : toKnowledgeBaseRecord(row);
  }

  async listKnowledgeSources(
    knowledgeBaseId: string,
  ): Promise<KnowledgeSourceRecord[]> {
    const rows = await this.db
      .select()
      .from(knowledgeSources)
      .where(eq(knowledgeSources.knowledgeBaseId, knowledgeBaseId))
      .orderBy(desc(knowledgeSources.updatedAt), asc(knowledgeSources.id));
    return rows.map(toKnowledgeSourceRecord);
  }

  async createKnowledgeSource(
    source: KnowledgeSourceRecord,
  ): Promise<KnowledgeSourceRecord> {
    const [row] = await this.db
      .insert(knowledgeSources)
      .values(toKnowledgeSourceInsert(source))
      .returning();
    return row === undefined ? source : toKnowledgeSourceRecord(row);
  }

  async updateKnowledgeSource(
    source: KnowledgeSourceRecord,
  ): Promise<KnowledgeSourceRecord> {
    const [row] = await this.db
      .update(knowledgeSources)
      .set({
        chunkCount: source.chunkCount ?? null,
        contentHash: source.contentHash ?? null,
        fileName: source.fileName,
        indexedAt: optionalDate(source.indexedAt),
        metadata: source.metadata,
        mimeType: source.mimeType,
        objectKey: source.objectKey ?? null,
        sizeBytes: source.sizeBytes,
        status: source.status,
        updatedAt: new Date(source.updatedAt),
      })
      .where(eq(knowledgeSources.id, source.id))
      .returning();
    return row === undefined ? source : toKnowledgeSourceRecord(row);
  }

  async deleteKnowledgeSource(
    sourceId: string,
  ): Promise<KnowledgeSourceRecord | undefined> {
    const [existing] = await this.db
      .select()
      .from(knowledgeSources)
      .where(eq(knowledgeSources.id, sourceId))
      .limit(1);
    if (existing === undefined) return undefined;
    await this.deleteKnowledgeChunksForSource(sourceId);
    await this.db
      .delete(knowledgeSources)
      .where(eq(knowledgeSources.id, sourceId));
    return toKnowledgeSourceRecord(existing);
  }

  async listKnowledgeChunks(
    knowledgeBaseId: string,
  ): Promise<KnowledgeChunkRecord[]> {
    const rows = await this.db
      .select()
      .from(knowledgeChunks)
      .where(eq(knowledgeChunks.knowledgeBaseId, knowledgeBaseId))
      .orderBy(asc(knowledgeChunks.sequence), asc(knowledgeChunks.id));
    return rows.map(toKnowledgeChunkRecord);
  }

  async createKnowledgeChunks(
    chunks: KnowledgeChunkRecord[],
  ): Promise<KnowledgeChunkRecord[]> {
    if (chunks.length === 0) return [];
    const rows = await this.db
      .insert(knowledgeChunks)
      .values(chunks.map(toKnowledgeChunkInsert))
      .returning();
    return rows.map(toKnowledgeChunkRecord);
  }

  async deleteKnowledgeChunksForSource(sourceId: string): Promise<void> {
    await this.db
      .delete(knowledgeChunkEmbeddings)
      .where(eq(knowledgeChunkEmbeddings.sourceId, sourceId));
    await this.db
      .delete(knowledgeChunks)
      .where(eq(knowledgeChunks.sourceId, sourceId));
  }
}

export function toKnowledgeBaseRecord(
  row: typeof knowledgeBases.$inferSelect,
): KnowledgeBaseRecord {
  const knowledgeBase: KnowledgeBaseRecord = {
    id: row.id,
    orgId: row.orgId,
    workspaceId: row.workspaceId,
    name: row.name,
    createdBy: row.createdBy,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
  const description = optionalIsoString(row.description);
  if (description !== undefined) knowledgeBase.description = description;
  return knowledgeBase;
}

export function toKnowledgeSourceRecord(
  row: typeof knowledgeSources.$inferSelect,
): KnowledgeSourceRecord {
  const source: KnowledgeSourceRecord = {
    id: row.id,
    knowledgeBaseId: row.knowledgeBaseId,
    orgId: row.orgId,
    workspaceId: row.workspaceId,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    status: asKnowledgeSourceStatus(row.status),
    metadata: asJsonRecord(row.metadata),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
  const objectKey = optionalIsoString(row.objectKey);
  if (objectKey !== undefined) source.objectKey = objectKey;
  if (row.chunkCount !== null) source.chunkCount = row.chunkCount;
  const contentHash = optionalIsoString(row.contentHash);
  if (contentHash !== undefined) source.contentHash = contentHash;
  const indexedAt = optionalIsoString(row.indexedAt);
  if (indexedAt !== undefined) source.indexedAt = indexedAt;
  return source;
}

export function toKnowledgeChunkRecord(
  row: typeof knowledgeChunks.$inferSelect,
): KnowledgeChunkRecord {
  return {
    id: row.id,
    knowledgeBaseId: row.knowledgeBaseId,
    sourceId: row.sourceId,
    orgId: row.orgId,
    workspaceId: row.workspaceId,
    sequence: row.sequence,
    content: row.content,
    tokenCount: row.tokenCount,
    metadata: asJsonRecord(row.metadata),
    createdAt: toIsoString(row.createdAt),
  };
}

function toKnowledgeBaseInsert(
  record: KnowledgeBaseRecord,
): typeof knowledgeBases.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    workspaceId: record.workspaceId,
    name: record.name,
    description: record.description ?? null,
    createdBy: record.createdBy,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}

function toKnowledgeSourceInsert(
  record: KnowledgeSourceRecord,
): typeof knowledgeSources.$inferInsert {
  return {
    id: record.id,
    knowledgeBaseId: record.knowledgeBaseId,
    orgId: record.orgId,
    workspaceId: record.workspaceId,
    fileName: record.fileName,
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    status: record.status,
    objectKey: record.objectKey ?? null,
    chunkCount: record.chunkCount ?? null,
    contentHash: record.contentHash ?? null,
    indexedAt: optionalDate(record.indexedAt),
    metadata: record.metadata,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}

function toKnowledgeChunkInsert(
  record: KnowledgeChunkRecord,
): typeof knowledgeChunks.$inferInsert {
  return {
    id: record.id,
    knowledgeBaseId: record.knowledgeBaseId,
    sourceId: record.sourceId,
    orgId: record.orgId,
    workspaceId: record.workspaceId,
    sequence: record.sequence,
    content: record.content,
    tokenCount: record.tokenCount,
    metadata: record.metadata,
    createdAt: new Date(record.createdAt),
  };
}

function asKnowledgeSourceStatus(value: string): KnowledgeSourceStatusRecord {
  if (value === "failed" || value === "indexed" || value === "pending")
    return value;
  return "failed";
}

function asJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return {};
  return value as Record<string, unknown>;
}

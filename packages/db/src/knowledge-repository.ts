import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
} from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import {
  knowledgeBases,
  knowledgeChunkEmbeddings,
  knowledgeChunks,
  knowledgeSources,
} from "./schema";
import { optionalDate } from "./repository-mapping";
import {
  toKnowledgeBaseInsert,
  toKnowledgeBaseRecord,
  toKnowledgeChunkInsert,
  toKnowledgeChunkRecord,
  toKnowledgeSourceInsert,
  toKnowledgeSourceRecord,
} from "./knowledge-record-mapping";

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

export type KnowledgeSourceStatusRecord =
  | "extracting"
  | "failed"
  | "indexed"
  | "pending";

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
  extractionLease?: {
    attempt: number;
    expiresAt: string;
    fencingToken: number;
    owner: string;
    token: string;
  };
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

  async getKnowledgeSource(
    sourceId: string,
  ): Promise<KnowledgeSourceRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(knowledgeSources)
      .where(eq(knowledgeSources.id, sourceId))
      .limit(1);
    return row === undefined ? undefined : toKnowledgeSourceRecord(row);
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

  async claimKnowledgeSourceExtraction(input: {
    knowledgeBaseId: string;
    leaseExpiresAt: string;
    leaseOwner: string;
    leaseToken: string;
    now: string;
    sourceId?: string;
  }): Promise<KnowledgeSourceRecord | undefined> {
    return this.db.transaction(async (transaction) => {
      const now = new Date(input.now);
      const [candidate] = await transaction
        .select()
        .from(knowledgeSources)
        .where(
          and(
            eq(knowledgeSources.knowledgeBaseId, input.knowledgeBaseId),
            input.sourceId === undefined
              ? undefined
              : eq(knowledgeSources.id, input.sourceId),
            isNotNull(knowledgeSources.objectKey),
            inArray(knowledgeSources.status, [
              "pending",
              "failed",
              "extracting",
            ]),
            or(
              isNull(knowledgeSources.extractionLeaseExpiresAt),
              lte(knowledgeSources.extractionLeaseExpiresAt, now),
            ),
          ),
        )
        .orderBy(asc(knowledgeSources.updatedAt), asc(knowledgeSources.id))
        .limit(1)
        .for("update", { skipLocked: true });
      if (candidate === undefined) return undefined;
      const [claimed] = await transaction
        .update(knowledgeSources)
        .set({
          extractionAttempts: candidate.extractionAttempts + 1,
          extractionFence: candidate.extractionFence + 1,
          extractionLeaseExpiresAt: new Date(input.leaseExpiresAt),
          extractionLeaseOwner: input.leaseOwner,
          extractionLeaseToken: input.leaseToken,
          status: "extracting",
          updatedAt: now,
        })
        .where(
          and(
            eq(knowledgeSources.id, candidate.id),
            eq(knowledgeSources.extractionFence, candidate.extractionFence),
          ),
        )
        .returning();
      return claimed === undefined
        ? undefined
        : toKnowledgeSourceRecord(claimed);
    });
  }

  async renewKnowledgeSourceExtractionLease(input: {
    fencingToken: number;
    leaseExpiresAt: string;
    leaseOwner: string;
    leaseToken: string;
    now: string;
    sourceId: string;
  }): Promise<KnowledgeSourceRecord | undefined> {
    const now = new Date(input.now);
    const [row] = await this.db
      .update(knowledgeSources)
      .set({
        extractionLeaseExpiresAt: new Date(input.leaseExpiresAt),
        updatedAt: now,
      })
      .where(
        and(
          eq(knowledgeSources.id, input.sourceId),
          eq(knowledgeSources.extractionFence, input.fencingToken),
          eq(knowledgeSources.extractionLeaseOwner, input.leaseOwner),
          eq(knowledgeSources.extractionLeaseToken, input.leaseToken),
          gt(knowledgeSources.extractionLeaseExpiresAt, now),
        ),
      )
      .returning();
    return row === undefined ? undefined : toKnowledgeSourceRecord(row);
  }

  async finishKnowledgeSourceExtraction(input: {
    chunks: KnowledgeChunkRecord[];
    fencingToken: number;
    leaseOwner: string;
    leaseToken: string;
    now: string;
    source: KnowledgeSourceRecord;
  }): Promise<KnowledgeSourceRecord | undefined> {
    try {
      return await this.db.transaction(async (transaction) => {
        const now = new Date(input.now);
        const [claimed] = await transaction
          .select({ id: knowledgeSources.id })
          .from(knowledgeSources)
          .where(
            and(
              eq(knowledgeSources.id, input.source.id),
              eq(knowledgeSources.extractionFence, input.fencingToken),
              eq(knowledgeSources.extractionLeaseOwner, input.leaseOwner),
              eq(knowledgeSources.extractionLeaseToken, input.leaseToken),
              gt(knowledgeSources.extractionLeaseExpiresAt, now),
            ),
          )
          .limit(1)
          .for("update");
        if (claimed === undefined) throw new WorkLeaseLostError();
        await transaction
          .delete(knowledgeChunkEmbeddings)
          .where(eq(knowledgeChunkEmbeddings.sourceId, input.source.id));
        await transaction
          .delete(knowledgeChunks)
          .where(eq(knowledgeChunks.sourceId, input.source.id));
        if (input.chunks.length > 0) {
          await transaction
            .insert(knowledgeChunks)
            .values(input.chunks.map(toKnowledgeChunkInsert));
        }
        const [source] = await transaction
          .update(knowledgeSources)
          .set({
            chunkCount: input.source.chunkCount ?? null,
            contentHash: input.source.contentHash ?? null,
            extractionLeaseExpiresAt: null,
            extractionLeaseOwner: null,
            extractionLeaseToken: null,
            indexedAt: optionalDate(input.source.indexedAt),
            metadata: input.source.metadata,
            sizeBytes: input.source.sizeBytes,
            status: input.source.status,
            updatedAt: new Date(input.source.updatedAt),
          })
          .where(
            and(
              eq(knowledgeSources.id, input.source.id),
              eq(knowledgeSources.extractionFence, input.fencingToken),
              eq(knowledgeSources.extractionLeaseToken, input.leaseToken),
            ),
          )
          .returning();
        if (source === undefined) throw new WorkLeaseLostError();
        return toKnowledgeSourceRecord(source);
      });
    } catch (error) {
      if (error instanceof WorkLeaseLostError) return undefined;
      throw error;
    }
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

class WorkLeaseLostError extends Error {}

export {
  toKnowledgeBaseRecord,
  toKnowledgeChunkRecord,
  toKnowledgeSourceRecord,
} from "./knowledge-record-mapping";

import { asc, eq } from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import { knowledgeChunkEmbeddings } from "./schema";
import { searchKnowledgeChunkEmbeddingsByCosineDistance } from "./vector-search";

export interface KnowledgeChunkEmbeddingRecord {
  id: string;
  knowledgeBaseId: string;
  sourceId: string;
  chunkId: string;
  orgId: string;
  workspaceId: string;
  embeddingProvider: string;
  embeddingModel: string;
  dimensions: number;
  embedding: number[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeChunkEmbeddingSearchInput {
  orgId: string;
  workspaceId: string;
  knowledgeBaseId: string;
  embeddingProvider: string;
  embeddingModel: string;
  dimensions: number;
  queryEmbedding: number[];
  maxResults: number;
}

export interface KnowledgeChunkEmbeddingSearchResult {
  embedding: KnowledgeChunkEmbeddingRecord;
  score: number;
}

export class PgKnowledgeEmbeddingRepository {
  constructor(private readonly db: RomeoDatabase) {}

  async listKnowledgeChunkEmbeddings(
    knowledgeBaseId: string,
  ): Promise<KnowledgeChunkEmbeddingRecord[]> {
    const rows = await this.db
      .select()
      .from(knowledgeChunkEmbeddings)
      .where(eq(knowledgeChunkEmbeddings.knowledgeBaseId, knowledgeBaseId))
      .orderBy(asc(knowledgeChunkEmbeddings.chunkId));
    return rows.map(toKnowledgeChunkEmbeddingRecord);
  }

  async searchKnowledgeChunkEmbeddings(
    input: KnowledgeChunkEmbeddingSearchInput,
  ): Promise<KnowledgeChunkEmbeddingSearchResult[]> {
    const hits = await searchKnowledgeChunkEmbeddingsByCosineDistance(
      this.db,
      input,
    );
    return hits.map((hit) => ({
      embedding: toKnowledgeChunkEmbeddingRecord(hit.embedding),
      score: hit.score,
    }));
  }

  async upsertKnowledgeChunkEmbeddings(
    embeddings: KnowledgeChunkEmbeddingRecord[],
  ): Promise<KnowledgeChunkEmbeddingRecord[]> {
    if (embeddings.length === 0) return [];
    const rows = await this.db
      .insert(knowledgeChunkEmbeddings)
      .values(embeddings.map(toKnowledgeChunkEmbeddingInsertValue))
      .onConflictDoUpdate({
        target: [
          knowledgeChunkEmbeddings.orgId,
          knowledgeChunkEmbeddings.chunkId,
          knowledgeChunkEmbeddings.embeddingProvider,
          knowledgeChunkEmbeddings.embeddingModel,
        ],
        set: {
          knowledgeBaseId: knowledgeChunkEmbeddings.knowledgeBaseId,
          sourceId: knowledgeChunkEmbeddings.sourceId,
          orgId: knowledgeChunkEmbeddings.orgId,
          workspaceId: knowledgeChunkEmbeddings.workspaceId,
          dimensions: knowledgeChunkEmbeddings.dimensions,
          embedding: knowledgeChunkEmbeddings.embedding,
          metadata: knowledgeChunkEmbeddings.metadata,
          updatedAt: knowledgeChunkEmbeddings.updatedAt,
        },
      })
      .returning();
    return rows.map(toKnowledgeChunkEmbeddingRecord);
  }

  async deleteKnowledgeChunkEmbeddingsForSource(
    sourceId: string,
  ): Promise<void> {
    await this.db
      .delete(knowledgeChunkEmbeddings)
      .where(eq(knowledgeChunkEmbeddings.sourceId, sourceId));
  }
}

export function toKnowledgeChunkEmbeddingRecord(
  row: typeof knowledgeChunkEmbeddings.$inferSelect,
): KnowledgeChunkEmbeddingRecord {
  return {
    id: row.id,
    knowledgeBaseId: row.knowledgeBaseId,
    sourceId: row.sourceId,
    chunkId: row.chunkId,
    orgId: row.orgId,
    workspaceId: row.workspaceId,
    embeddingProvider: row.embeddingProvider,
    embeddingModel: row.embeddingModel,
    dimensions: row.dimensions,
    embedding: row.embedding,
    metadata: asMetadata(row.metadata),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

export function toKnowledgeChunkEmbeddingInsertValue(
  record: KnowledgeChunkEmbeddingRecord,
): typeof knowledgeChunkEmbeddings.$inferInsert {
  return {
    id: record.id,
    knowledgeBaseId: record.knowledgeBaseId,
    sourceId: record.sourceId,
    chunkId: record.chunkId,
    orgId: record.orgId,
    workspaceId: record.workspaceId,
    embeddingProvider: record.embeddingProvider,
    embeddingModel: record.embeddingModel,
    dimensions: record.dimensions,
    embedding: record.embedding,
    metadata: record.metadata,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}

function asMetadata(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

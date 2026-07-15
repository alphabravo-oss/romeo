import { and, asc, eq, sql } from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import { knowledgeChunkEmbeddings } from "./schema";

export interface PgVectorKnowledgeSearchInput {
  orgId: string;
  workspaceId: string;
  knowledgeBaseId: string;
  embeddingProvider: string;
  embeddingModel: string;
  dimensions: number;
  queryEmbedding: number[];
  maxResults: number;
}

export interface PgVectorKnowledgeEmbeddingHit {
  embedding: typeof knowledgeChunkEmbeddings.$inferSelect;
  score: number;
}

const maxPgVectorResults = 100;

export async function searchKnowledgeChunkEmbeddingsByCosineDistance(
  db: RomeoDatabase,
  input: PgVectorKnowledgeSearchInput,
): Promise<PgVectorKnowledgeEmbeddingHit[]> {
  const vectorLiteral = toPgVectorLiteral(
    input.queryEmbedding,
    input.dimensions,
  );
  const maxResults = boundedMaxResults(input.maxResults);
  const distance = sql<number>`${knowledgeChunkEmbeddings.embedding} <=> ${vectorLiteral}::vector`;
  const rows = await db
    .select({
      embedding: knowledgeChunkEmbeddings,
      score: sql<number>`1 - (${distance})`,
    })
    .from(knowledgeChunkEmbeddings)
    .where(
      and(
        eq(knowledgeChunkEmbeddings.orgId, input.orgId),
        eq(knowledgeChunkEmbeddings.workspaceId, input.workspaceId),
        eq(knowledgeChunkEmbeddings.knowledgeBaseId, input.knowledgeBaseId),
        eq(knowledgeChunkEmbeddings.embeddingProvider, input.embeddingProvider),
        eq(knowledgeChunkEmbeddings.embeddingModel, input.embeddingModel),
        eq(knowledgeChunkEmbeddings.dimensions, input.dimensions),
      ),
    )
    .orderBy(asc(distance), asc(knowledgeChunkEmbeddings.chunkId))
    .limit(maxResults);

  return rows.map((row) => ({
    embedding: row.embedding,
    score: Number(row.score),
  }));
}

export function toPgVectorLiteral(
  values: number[],
  dimensions: number,
): string {
  if (!Number.isInteger(dimensions) || dimensions <= 0)
    throw new Error("Vector dimensions must be a positive integer.");
  if (values.length !== dimensions)
    throw new Error(
      `Expected ${dimensions} vector dimensions but received ${values.length}.`,
    );
  return `[${values.map(formatPgVectorNumber).join(",")}]`;
}

function formatPgVectorNumber(value: number): string {
  if (!Number.isFinite(value))
    throw new Error("Vector values must be finite numbers.");
  return Object.is(value, -0) ? "0" : String(value);
}

function boundedMaxResults(maxResults: number): number {
  if (
    !Number.isInteger(maxResults) ||
    maxResults < 1 ||
    maxResults > maxPgVectorResults
  ) {
    throw new Error(
      `Vector search maxResults must be between 1 and ${maxPgVectorResults}.`,
    );
  }
  return maxResults;
}

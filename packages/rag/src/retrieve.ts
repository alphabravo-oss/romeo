import type { IndexedChunk, RetrievalHit } from "./types";
import { cosineSimilarity, createTextEmbedding } from "./embeddings";

export interface RetrieveFromChunksOptions {
  hybrid?: boolean;
  /** Lexical share when hybrid is on (0–1). Vector weight is the remainder. */
  bm25Weight?: number;
  similarityThreshold?: number;
}

export function retrieveFromChunks(
  chunks: IndexedChunk[],
  query: string,
  maxResults = 5,
  options: RetrieveFromChunksOptions = {},
): RetrievalHit[] {
  const terms = tokenize(query);
  const queryEmbedding = createTextEmbedding(query);
  if (terms.length === 0 && queryEmbedding.every((value) => value === 0))
    return [];
  const hybrid = options.hybrid !== false;
  const threshold = options.similarityThreshold ?? 0.35;
  const bm25Weight = clampUnit(options.bm25Weight ?? 0.75);

  return chunks
    .map((chunk) => {
      const lexical = scoreChunk(chunk.content, terms);
      const vector = vectorScore(chunk, queryEmbedding, threshold);
      const score = hybrid
        ? lexical * bm25Weight + vector * (1 - bm25Weight)
        : vector > 0
          ? vector
          : lexical;
      return { chunk, score };
    })
    .filter((item) => item.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.chunk.sequence - right.chunk.sequence,
    )
    .slice(0, maxResults)
    .map(({ chunk, score }) => {
      const citation = {
        documentId: chunk.sourceId,
        chunkId: chunk.id,
        title: chunk.sourceTitle,
      };
      return {
        id: chunk.id,
        content: chunk.content,
        score,
        citation: chunk.sourceUri
          ? { ...citation, sourceUri: chunk.sourceUri }
          : citation,
        metadata: chunk.metadata,
      };
    });
}

function vectorScore(
  chunk: IndexedChunk,
  queryEmbedding: number[],
  threshold: number,
): number {
  if (chunk.embedding === undefined) return 0;
  const similarity = cosineSimilarity(chunk.embedding, queryEmbedding);
  return similarity >= threshold ? similarity : 0;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0.75;
  return Math.min(1, Math.max(0, value));
}

function scoreChunk(content: string, terms: string[]): number {
  const words = tokenize(content);
  if (words.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  const matched = terms.reduce(
    (total, term) => total + (counts.get(term) ?? 0),
    0,
  );
  return matched === 0 ? 0 : matched / Math.sqrt(words.length);
}

function tokenize(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

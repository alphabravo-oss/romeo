import type { RetrievalHit } from "@romeo/rag";

export interface HybridRetrievalInput {
  lexicalHits: RetrievalHit[];
  maxResults: number;
  vectorHits: RetrievalHit[];
  /** Lexical share of rank fusion (0–1). Vector weight is the remainder. */
  bm25Weight?: number;
}

export function mergeHybridRetrievalHits(
  input: HybridRetrievalInput,
): RetrievalHit[] {
  const lexicalWeight = clampUnit(input.bm25Weight ?? 0.35);
  const vectorWeight = 1 - lexicalWeight;
  const merged = new Map<
    string,
    { bestRank: number; hit: RetrievalHit; score: number }
  >();
  input.vectorHits.forEach((hit, index) =>
    mergeRankedHit(merged, hit, index, vectorWeight),
  );
  input.lexicalHits.forEach((hit, index) =>
    mergeRankedHit(merged, hit, index, lexicalWeight),
  );
  return [...merged.values()]
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.bestRank - right.bestRank ||
        left.hit.id.localeCompare(right.hit.id),
    )
    .slice(0, input.maxResults)
    .map(({ hit, score }) => ({ ...hit, score }));
}

function mergeRankedHit(
  merged: Map<string, { bestRank: number; hit: RetrievalHit; score: number }>,
  hit: RetrievalHit,
  index: number,
  weight: number,
): void {
  const existing = merged.get(hit.id);
  const rank = index + 1;
  const score = weight / rank;
  if (existing === undefined) {
    merged.set(hit.id, { bestRank: rank, hit, score });
    return;
  }
  existing.bestRank = Math.min(existing.bestRank, rank);
  existing.score += score;
  if (hit.score > existing.hit.score) existing.hit = hit;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0.35;
  return Math.min(1, Math.max(0, value));
}

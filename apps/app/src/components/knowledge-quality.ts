import type { KnowledgeSource } from "../features/knowledge/types";

const freshnessWindowMs = 30 * 24 * 60 * 60 * 1_000;

export interface KnowledgeQualitySummary {
  duplicateSources: number;
  failedSources: number;
  healthySources: number;
  pendingSources: number;
  staleSources: number;
  totalChunks: number;
}

/**
 * A client-side summary keeps the cockpit on the existing source query and
 * avoids turning every navigation into another analytics waterfall.
 */
export function summarizeKnowledgeQuality(
  sources: KnowledgeSource[],
  nowMs = Date.now(),
): KnowledgeQualitySummary {
  const contentHashCounts = new Map<string, number>();
  let duplicateSources = 0;
  let failedSources = 0;
  let healthySources = 0;
  let pendingSources = 0;
  let staleSources = 0;
  let totalChunks = 0;

  for (const source of sources) {
    totalChunks += source.chunkCount ?? 0;
    if (source.contentHash !== undefined) {
      const count = (contentHashCounts.get(source.contentHash) ?? 0) + 1;
      contentHashCounts.set(source.contentHash, count);
      if (count > 1) duplicateSources += 1;
    }

    if (source.status === "failed") {
      failedSources += 1;
      continue;
    }
    if (source.status !== "indexed") {
      pendingSources += 1;
      continue;
    }

    const indexedAtMs =
      source.indexedAt === undefined
        ? Number.NaN
        : Date.parse(source.indexedAt);
    if (
      !Number.isFinite(indexedAtMs) ||
      nowMs - indexedAtMs > freshnessWindowMs
    ) {
      staleSources += 1;
    } else {
      healthySources += 1;
    }
  }

  return {
    duplicateSources,
    failedSources,
    healthySources,
    pendingSources,
    staleSources,
    totalChunks,
  };
}

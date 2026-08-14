import type { RetrievalHit } from "@romeo/rag";

import type { AuditMetadata } from "./audit-log";

import type {
  KnowledgeRetrievalPlan,
  KnowledgeRetrievalPlanEntry,
  KnowledgeRetrievalTier,
} from "./knowledge-retrieval-plan";
import type { KnowledgeRetrievalRoute } from "./knowledge-retrieval-route";

export interface TieredRetrievalHit extends RetrievalHit {
  knowledgeBaseId: string;
  orgId: string;
  permissionReason: KnowledgeRetrievalPlanEntry["permissionReason"];
  retrievalRoute: KnowledgeRetrievalRoute;
  tier: KnowledgeRetrievalTier;
  workspaceId: string;
}

export interface TieredKnowledgeQueryResult {
  hits: TieredRetrievalHit[];
  plan: KnowledgeRetrievalPlan;
}

export interface KnowledgeRetrievalReplayCaseInput {
  id?: string;
  expectedChunkIds?: string[];
  knowledgeBaseIds: string[];
  maxResultsPerTier?: Partial<
    Record<KnowledgeRetrievalTier, number | undefined>
  >;
  query: string;
}

export interface KnowledgeRetrievalReplayCaseResult {
  authorizedKnowledgeBaseCount: number;
  caseId?: string;
  expectedChunkCount: number;
  fallbackReasons: Partial<
    Record<NonNullable<KnowledgeRetrievalRoute["fallbackReason"]>, number>
  >;
  hitCount: number;
  latencyMs: number;
  matchedExpectedChunkCount: number;
  precision: number | null;
  recall: number | null;
  retrievalRouteModes: Record<KnowledgeRetrievalRoute["mode"], number>;
  skippedKnowledgeBaseCount: number;
  status: "failed" | "observed" | "passed";
}

export interface KnowledgeRetrievalReplayReport {
  caseCount: number;
  cases: KnowledgeRetrievalReplayCaseResult[];
  generatedAt: string;
  metrics: {
    averageLatencyMs: number;
    averagePrecision: number | null;
    averageRecall: number | null;
    expectedChunkCount: number;
    hitCount: number;
    matchedExpectedChunkCount: number;
  };
  orgId: string;
  redaction: ReplayRedaction;
  status: "failed" | "observed" | "passed";
}

export interface KnowledgeRetrievalReplayComparisonReport {
  baseline: KnowledgeRetrievalReplayReport;
  candidate: KnowledgeRetrievalReplayReport;
  deltas: {
    averageLatencyMs: number;
    averagePrecision: number | null;
    averageRecall: number | null;
    expectedChunkCount: number;
    hitCount: number;
    matchedExpectedChunkCount: number;
  };
  generatedAt: string;
  orgId: string;
  outcome: "improved" | "observed" | "regressed" | "unchanged";
  redaction: ReplayRedaction;
}

interface ReplayRedaction {
  rawQueriesReturned: false;
  rawChunkTextReturned: false;
  rawExpectedChunkIdsReturned: false;
  rawHitIdsReturned: false;
  vectorValuesReturned: false;
}

export function scoreReplayCase(
  replayCase: KnowledgeRetrievalReplayCaseInput,
  result: TieredKnowledgeQueryResult,
  latencyMs: number,
): KnowledgeRetrievalReplayCaseResult {
  const expectedChunkIds = new Set(replayCase.expectedChunkIds ?? []);
  const hitChunkIds = result.hits.map((hit) => hit.citation.chunkId);
  const matchedExpectedChunkCount = [...expectedChunkIds].filter((chunkId) =>
    hitChunkIds.includes(chunkId),
  ).length;
  const precision =
    expectedChunkIds.size === 0
      ? null
      : hitChunkIds.length === 0
        ? 0
        : matchedExpectedChunkCount / hitChunkIds.length;
  const recall =
    expectedChunkIds.size === 0
      ? null
      : matchedExpectedChunkCount / expectedChunkIds.size;
  return {
    authorizedKnowledgeBaseCount: result.plan.authorizedCount,
    expectedChunkCount: expectedChunkIds.size,
    fallbackReasons: routeFallbackReasonCounts(result.plan.entries),
    hitCount: result.hits.length,
    latencyMs,
    matchedExpectedChunkCount,
    precision,
    recall,
    retrievalRouteModes: routeModeCounts(result.plan.entries),
    skippedKnowledgeBaseCount: result.plan.skipped.count,
    status:
      expectedChunkIds.size === 0
        ? "observed"
        : matchedExpectedChunkCount === expectedChunkIds.size
          ? "passed"
          : "failed",
    ...(replayCase.id === undefined ? {} : { caseId: replayCase.id }),
  };
}

export function buildReplayReport(
  orgId: string,
  cases: KnowledgeRetrievalReplayCaseResult[],
): KnowledgeRetrievalReplayReport {
  const expectedCases = cases.filter((testCase) => testCase.recall !== null);
  const status =
    expectedCases.length === 0
      ? "observed"
      : cases.some((testCase) => testCase.status === "failed")
        ? "failed"
        : "passed";
  return {
    caseCount: cases.length,
    cases,
    generatedAt: new Date().toISOString(),
    metrics: {
      averageLatencyMs:
        average(cases.map((testCase) => testCase.latencyMs)) ?? 0,
      averagePrecision: average(
        expectedCases.flatMap((testCase) =>
          testCase.precision === null ? [] : [testCase.precision],
        ),
      ),
      averageRecall: average(
        expectedCases.flatMap((testCase) =>
          testCase.recall === null ? [] : [testCase.recall],
        ),
      ),
      expectedChunkCount: sum(cases, "expectedChunkCount"),
      hitCount: sum(cases, "hitCount"),
      matchedExpectedChunkCount: sum(cases, "matchedExpectedChunkCount"),
    },
    orgId,
    redaction: replayRedaction(),
    status,
  };
}

export function buildReplayComparisonReport(
  orgId: string,
  baseline: KnowledgeRetrievalReplayReport,
  candidate: KnowledgeRetrievalReplayReport,
): KnowledgeRetrievalReplayComparisonReport {
  const deltas = {
    averageLatencyMs:
      candidate.metrics.averageLatencyMs - baseline.metrics.averageLatencyMs,
    averagePrecision: nullableDelta(
      baseline.metrics.averagePrecision,
      candidate.metrics.averagePrecision,
    ),
    averageRecall: nullableDelta(
      baseline.metrics.averageRecall,
      candidate.metrics.averageRecall,
    ),
    expectedChunkCount:
      candidate.metrics.expectedChunkCount -
      baseline.metrics.expectedChunkCount,
    hitCount: candidate.metrics.hitCount - baseline.metrics.hitCount,
    matchedExpectedChunkCount:
      candidate.metrics.matchedExpectedChunkCount -
      baseline.metrics.matchedExpectedChunkCount,
  };
  return {
    baseline,
    candidate,
    deltas,
    generatedAt: new Date().toISOString(),
    orgId,
    outcome: replayComparisonOutcome(baseline, candidate, deltas),
    redaction: replayRedaction(),
  };
}

export function tierEntryCounts(
  entries: KnowledgeRetrievalPlanEntry[],
): Record<KnowledgeRetrievalTier, number> {
  const counts = emptyTierCounts();
  for (const entry of entries) counts[entry.tier] += 1;
  return counts;
}

export function tierHitCounts(
  hits: TieredRetrievalHit[],
): Record<KnowledgeRetrievalTier, number> {
  const counts = emptyTierCounts();
  for (const hit of hits) counts[hit.tier] += 1;
  return counts;
}

export function routeModeCounts(
  entries: KnowledgeRetrievalPlanEntry[],
): Record<KnowledgeRetrievalRoute["mode"], number> {
  const counts: Record<KnowledgeRetrievalRoute["mode"], number> = {
    external_vector: 0,
    legacy_rag_provider: 0,
    lexical_fallback: 0,
    pgvector: 0,
  };
  for (const entry of entries) {
    const mode = entry.retrievalRoute?.mode;
    if (mode !== undefined) counts[mode] += 1;
  }
  return counts;
}

export function routeFallbackReasonCounts(
  entries: KnowledgeRetrievalPlanEntry[],
): Partial<
  Record<NonNullable<KnowledgeRetrievalRoute["fallbackReason"]>, number>
> {
  const counts = new Map<
    NonNullable<KnowledgeRetrievalRoute["fallbackReason"]>,
    number
  >();
  for (const entry of entries) {
    const reason = entry.retrievalRoute?.fallbackReason;
    if (reason !== undefined) counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return Object.fromEntries(counts.entries());
}

export function vectorProviderIds(
  entries: KnowledgeRetrievalPlanEntry[],
): string[] {
  return uniqueSorted(
    entries.flatMap((entry) =>
      entry.retrievalRoute?.providerId === undefined
        ? []
        : [entry.retrievalRoute.providerId],
    ),
  );
}

export function vectorEmbeddingModels(
  entries: KnowledgeRetrievalPlanEntry[],
): string[] {
  return uniqueSorted(
    entries.flatMap((entry) =>
      entry.retrievalRoute?.embeddingModel === undefined
        ? []
        : [entry.retrievalRoute.embeddingModel],
    ),
  );
}

export function replayAuditMetadata(
  report: KnowledgeRetrievalReplayReport,
): AuditMetadata<"knowledge.replay.tiered"> {
  return {
    averageLatencyMs: report.metrics.averageLatencyMs,
    averagePrecision: report.metrics.averagePrecision,
    averageRecall: report.metrics.averageRecall,
    caseCount: report.caseCount,
    expectedChunkCount: report.metrics.expectedChunkCount,
    hitCount: report.metrics.hitCount,
    matchedExpectedChunkCount: report.metrics.matchedExpectedChunkCount,
    status: report.status,
  };
}

function replayComparisonOutcome(
  baseline: KnowledgeRetrievalReplayReport,
  candidate: KnowledgeRetrievalReplayReport,
  deltas: KnowledgeRetrievalReplayComparisonReport["deltas"],
): KnowledgeRetrievalReplayComparisonReport["outcome"] {
  const baselineScore = replayQualityScore(baseline);
  const candidateScore = replayQualityScore(candidate);
  if (baselineScore === null || candidateScore === null) return "observed";
  if (candidateScore > baselineScore) return "improved";
  if (candidateScore < baselineScore) return "regressed";
  if (deltas.averageLatencyMs < 0) return "improved";
  if (deltas.averageLatencyMs > 0) return "regressed";
  return "unchanged";
}

function replayQualityScore(
  report: KnowledgeRetrievalReplayReport,
): number | null {
  return report.metrics.averageRecall ?? report.metrics.averagePrecision;
}

function nullableDelta(
  baseline: number | null,
  candidate: number | null,
): number | null {
  return baseline === null || candidate === null ? null : candidate - baseline;
}

function emptyTierCounts(): Record<KnowledgeRetrievalTier, number> {
  return { user_private: 0, workspace: 0, org: 0, shared: 0 };
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function replayRedaction(): ReplayRedaction {
  return {
    rawChunkTextReturned: false,
    rawExpectedChunkIdsReturned: false,
    rawHitIdsReturned: false,
    rawQueriesReturned: false,
    vectorValuesReturned: false,
  };
}

function sum(
  cases: KnowledgeRetrievalReplayCaseResult[],
  key: "expectedChunkCount" | "hitCount" | "matchedExpectedChunkCount",
): number {
  return cases.reduce((total, testCase) => total + testCase[key], 0);
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

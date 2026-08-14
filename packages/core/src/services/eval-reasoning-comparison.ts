import type { EvalReasoningComparison, EvalRun } from "../domain/entities";

export function buildEvalReasoningComparison(
  suiteId: string,
  runs: EvalRun[],
): EvalReasoningComparison {
  const groups = new Map<string, EvalRun[]>();
  for (const run of runs) {
    if (
      run.suiteId !== suiteId ||
      run.reasoningPolicy === undefined ||
      run.metrics === undefined
    )
      continue;
    const key = JSON.stringify({
      modelId: run.modelId,
      requested: run.reasoningPolicy.requested,
      effective: run.reasoningPolicy.effective,
    });
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }
  return {
    suiteId,
    generatedAt: new Date().toISOString(),
    variants: [...groups.values()].map((variantRuns) => {
      const first = variantRuns[0]!;
      const comparableUsage = variantRuns.every(
        (run) =>
          run.metrics?.usage.coverage === "complete" &&
          run.metrics.usage.inputTokens !== undefined &&
          run.metrics.usage.outputTokens !== undefined,
      );
      const comparableReasoning =
        comparableUsage &&
        variantRuns.every(
          (run) => run.metrics?.usage.reasoningTokens !== undefined,
        );
      const comparableCost = variantRuns.every(
        (run) =>
          run.metrics?.costBasis === "reported_tokens" &&
          run.metrics.estimatedCostUsd !== undefined,
      );
      const sorted = [...variantRuns].sort((left, right) =>
        left.completedAt.localeCompare(right.completedAt),
      );
      return {
        modelId: first.modelId,
        requested: first.reasoningPolicy!.requested,
        effective: first.reasoningPolicy!.effective,
        runCount: sorted.length,
        averageScore: average(sorted.map((run) => run.score)),
        averageLatencyMs: average(sorted.map((run) => run.metrics!.latencyMs)),
        reportedInputTokens: comparableUsage
          ? total(sorted, "inputTokens")
          : null,
        reportedOutputTokens: comparableUsage
          ? total(sorted, "outputTokens")
          : null,
        reportedReasoningTokens: comparableReasoning
          ? total(sorted, "reasoningTokens")
          : null,
        estimatedCostUsd: comparableCost ? totalCost(sorted) : null,
        trend: sorted.slice(-100).map((run) => ({
          runId: run.id,
          score: run.score,
          latencyMs: run.metrics!.latencyMs,
          completedAt: run.completedAt,
        })),
      };
    }),
  };
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function totalCost(runs: EvalRun[]): number | null {
  const total = runs.reduce(
    (sum, run) => sum + (run.metrics?.estimatedCostUsd ?? 0),
    0,
  );
  return Number.isFinite(total) && total >= 0 && total <= 1_000_000
    ? total
    : null;
}

function total(
  runs: EvalRun[],
  field: "inputTokens" | "outputTokens" | "reasoningTokens",
): number {
  return Math.min(
    2_000_000_000,
    runs.reduce((sum, run) => sum + (run.metrics?.usage[field] ?? 0), 0),
  );
}

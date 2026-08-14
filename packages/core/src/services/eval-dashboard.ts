import type { EvalDashboard, EvalRun, EvalSuite } from "../domain/entities";

export function buildEvalDashboard(
  agentId: string,
  suites: EvalSuite[],
  runs: EvalRun[],
): EvalDashboard {
  const suiteSummaries: EvalDashboard["suites"] = suites.map((suite) => {
    const suiteRuns = runs
      .filter((run) => run.suiteId === suite.id)
      .sort((left, right) => right.completedAt.localeCompare(left.completedAt));
    const latestRun = suiteRuns[0];
    return {
      suiteId: suite.id,
      name: suite.name,
      latestRunId: latestRun?.id ?? null,
      status: latestRun?.status ?? "missing",
      score: latestRun?.score ?? null,
      completedAt: latestRun?.completedAt ?? null,
      runCount: suiteRuns.length,
    };
  });
  const completedSuites = suiteSummaries.filter(
    (suite) => suite.score !== null,
  );
  const failedCount = suiteSummaries.filter(
    (suite) => suite.status === "failed",
  ).length;
  const missingCount = suiteSummaries.filter(
    (suite) => suite.status === "missing",
  ).length;

  return {
    agentId,
    generatedAt: new Date().toISOString(),
    status:
      suites.length === 0
        ? "not_required"
        : missingCount > 0
          ? "missing"
          : failedCount > 0
            ? "failed"
            : "passed",
    suiteCount: suites.length,
    runCount: runs.length,
    averageLatestScore:
      completedSuites.length === 0
        ? null
        : completedSuites.reduce(
            (total, suite) => total + (suite.score ?? 0),
            0,
          ) / completedSuites.length,
    suites: suiteSummaries,
    trend: [...runs]
      .sort((left, right) => right.completedAt.localeCompare(left.completedAt))
      .slice(0, 20)
      .map((run) => ({
        runId: run.id,
        suiteId: run.suiteId,
        modelId: run.modelId,
        status: run.status,
        score: run.score,
        completedAt: run.completedAt,
        ...(run.reasoningPolicy === undefined
          ? {}
          : { reasoningPolicy: run.reasoningPolicy }),
        ...(run.metrics === undefined ? {} : { metrics: run.metrics }),
      }))
      .reverse(),
  };
}

import type {
  AgentVersionEvalSummary,
  EvalRun,
  EvalSuite,
} from "../domain/entities";

export function buildVersionEvalSummary(
  publishedAt: string,
  suites: EvalSuite[],
  runs: EvalRun[],
): AgentVersionEvalSummary {
  if (suites.length === 0) {
    return {
      status: "not_required",
      suiteCount: 0,
      passedSuiteCount: 0,
      failedSuiteCount: 0,
      missingSuiteCount: 0,
      averageScore: null,
      evaluatedAt: null,
      suites: [],
    };
  }

  const suiteSummaries: AgentVersionEvalSummary["suites"] = suites.map(
    (suite) => {
      const latestRun = latestRunForSuiteAtOrBefore(
        suite.id,
        runs,
        publishedAt,
      );
      return {
        suiteId: suite.id,
        runId: latestRun?.id ?? null,
        status: latestRun?.status ?? "missing",
        score: latestRun?.score ?? null,
        completedAt: latestRun?.completedAt ?? null,
      };
    },
  );
  const completedSummaries = suiteSummaries.filter(
    (suite) => suite.score !== null,
  );
  const passedSuiteCount = suiteSummaries.filter(
    (suite) => suite.status === "passed",
  ).length;
  const failedSuiteCount = suiteSummaries.filter(
    (suite) => suite.status === "failed",
  ).length;
  const missingSuiteCount = suiteSummaries.filter(
    (suite) => suite.status === "missing",
  ).length;
  const evaluatedAt = suiteSummaries
    .map((suite) => suite.completedAt)
    .filter((completedAt): completedAt is string => completedAt !== null)
    .sort()
    .at(-1);

  return {
    status:
      missingSuiteCount > 0
        ? "missing"
        : failedSuiteCount > 0
          ? "failed"
          : "passed",
    suiteCount: suites.length,
    passedSuiteCount,
    failedSuiteCount,
    missingSuiteCount,
    averageScore:
      completedSummaries.length === 0
        ? null
        : completedSummaries.reduce(
            (total, suite) => total + (suite.score ?? 0),
            0,
          ) / completedSummaries.length,
    evaluatedAt: evaluatedAt ?? null,
    suites: suiteSummaries,
  };
}

function latestRunForSuiteAtOrBefore(
  suiteId: string,
  runs: EvalRun[],
  publishedAt: string,
): EvalRun | undefined {
  return runs
    .filter((run) => run.suiteId === suiteId && run.completedAt <= publishedAt)
    .sort((left, right) =>
      right.completedAt.localeCompare(left.completedAt),
    )[0];
}

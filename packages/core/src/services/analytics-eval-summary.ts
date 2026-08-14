import type { Agent, EvalRun, EvalSuite } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import type {
  AdminAnalyticsEvalAgentSummary,
  AdminAnalyticsEvalModelSummary,
  AdminAnalyticsEvalSuiteSummary,
  AdminAnalyticsEvalSummary,
} from "./analytics-types";

export async function buildAnalyticsEvalSummary(
  repository: RomeoRepository,
  agents: Agent[],
): Promise<AdminAnalyticsEvalSummary> {
  const agentSummaries: AdminAnalyticsEvalAgentSummary[] = [];
  const suiteSummaries: AdminAnalyticsEvalSuiteSummary[] = [];
  const [allSuites, allRuns] = await Promise.all([
    repository.listEvalSuitesForAgents(agents.map((agent) => agent.id)),
    repository.listEvalRunsForAgents(agents.map((agent) => agent.id)),
  ]);
  const suitesByAgent = groupByAgent(allSuites);
  const runsByAgent = groupByAgent(allRuns);

  for (const agent of agents) {
    const suites = suitesByAgent.get(agent.id) ?? [];
    const runs = runsByAgent.get(agent.id) ?? [];
    const agentSuiteSummaries = suites.map((suite) =>
      summarizeSuite(agent, suite, runs),
    );
    suiteSummaries.push(...agentSuiteSummaries);
    agentSummaries.push(summarizeAgent(agent, suites, runs));
  }

  const completedSuites = suiteSummaries.filter(
    (suite) => suite.latestScore !== undefined,
  );
  const failedSuiteCount = suiteSummaries.filter(
    (suite) => suite.latestStatus === "failed",
  ).length;
  const missingSuiteCount = suiteSummaries.filter(
    (suite) => suite.latestStatus === "missing",
  ).length;
  const passedSuiteCount = suiteSummaries.filter(
    (suite) => suite.latestStatus === "passed",
  ).length;
  const status =
    suiteSummaries.length === 0
      ? "not_required"
      : missingSuiteCount > 0
        ? "missing"
        : failedSuiteCount > 0
          ? "failed"
          : "passed";

  return {
    agentCount: agents.length,
    agents: agentSummaries.sort(compareAgentSummaries),
    averageLatestScore:
      completedSuites.length === 0
        ? null
        : completedSuites.reduce(
            (total, suite) => total + (suite.latestScore ?? 0),
            0,
          ) / completedSuites.length,
    byModel: summarizeEvalModels(allRuns),
    failedSuiteCount,
    generatedRunCount: allRuns.length,
    missingSuiteCount,
    passedSuiteCount,
    releaseGate: {
      failedSuiteCount,
      missingSuiteCount,
      requiredSuiteCount: suiteSummaries.length,
      status,
    },
    status,
    suiteCount: suiteSummaries.length,
    suites: suiteSummaries.sort(compareSuiteSummaries),
  };
}

function summarizeSuite(
  agent: Agent,
  suite: EvalSuite,
  runs: EvalRun[],
): AdminAnalyticsEvalSuiteSummary {
  const suiteRuns = runs
    .filter((run) => run.suiteId === suite.id)
    .sort(compareRunsNewestFirst);
  const latestRun = suiteRuns[0];
  return {
    agentId: agent.id,
    workspaceId: agent.workspaceId,
    suiteId: suite.id,
    latestStatus: latestRun?.status ?? "missing",
    runCount: suiteRuns.length,
    ...(latestRun === undefined
      ? {}
      : {
          latestCompletedAt: latestRun.completedAt,
          latestRunId: latestRun.id,
          latestScore: latestRun.score,
        }),
  };
}

function summarizeAgent(
  agent: Agent,
  suites: EvalSuite[],
  runs: EvalRun[],
): AdminAnalyticsEvalAgentSummary {
  const latestRun = [...runs].sort(compareRunsNewestFirst)[0];
  const suiteSummaries = suites.map((suite) =>
    summarizeSuite(agent, suite, runs),
  );
  const failedSuiteCount = suiteSummaries.filter(
    (suite) => suite.latestStatus === "failed",
  ).length;
  const missingSuiteCount = suiteSummaries.filter(
    (suite) => suite.latestStatus === "missing",
  ).length;
  const latestStatus =
    suites.length === 0
      ? "not_required"
      : missingSuiteCount > 0
        ? "missing"
        : failedSuiteCount > 0
          ? "failed"
          : "passed";
  return {
    agentId: agent.id,
    workspaceId: agent.workspaceId,
    latestStatus,
    runCount: runs.length,
    suiteCount: suites.length,
    ...(latestRun === undefined
      ? {}
      : {
          latestCompletedAt: latestRun.completedAt,
          latestRunId: latestRun.id,
          latestScore: latestRun.score,
        }),
  };
}

function summarizeEvalModels(
  runs: EvalRun[],
): AdminAnalyticsEvalModelSummary[] {
  const byModel = new Map<string, EvalRun[]>();
  for (const run of runs) {
    byModel.set(run.modelId, [...(byModel.get(run.modelId) ?? []), run]);
  }
  return Array.from(byModel.entries())
    .map(([modelId, modelRuns]) => {
      const latestRun = [...modelRuns].sort(compareRunsNewestFirst)[0];
      const passedRunCount = modelRuns.filter(
        (run) => run.status === "passed",
      ).length;
      const failedRunCount = modelRuns.length - passedRunCount;
      return {
        averageScore:
          modelRuns.reduce((total, run) => total + run.score, 0) /
          modelRuns.length,
        failedRunCount,
        modelId,
        passedRunCount,
        runCount: modelRuns.length,
        ...(latestRun === undefined
          ? {}
          : {
              latestCompletedAt: latestRun.completedAt,
              latestRunId: latestRun.id,
            }),
      };
    })
    .sort((left, right) => left.modelId.localeCompare(right.modelId));
}

function groupByAgent<T extends { agentId: string }>(
  values: T[],
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const value of values) {
    const items = grouped.get(value.agentId) ?? [];
    items.push(value);
    grouped.set(value.agentId, items);
  }
  return grouped;
}

function compareRunsNewestFirst(left: EvalRun, right: EvalRun): number {
  const completedDelta = right.completedAt.localeCompare(left.completedAt);
  return completedDelta === 0
    ? right.id.localeCompare(left.id)
    : completedDelta;
}

function compareAgentSummaries(
  left: AdminAnalyticsEvalAgentSummary,
  right: AdminAnalyticsEvalAgentSummary,
): number {
  const workspaceDelta = left.workspaceId.localeCompare(right.workspaceId);
  return workspaceDelta === 0
    ? left.agentId.localeCompare(right.agentId)
    : workspaceDelta;
}

function compareSuiteSummaries(
  left: AdminAnalyticsEvalSuiteSummary,
  right: AdminAnalyticsEvalSuiteSummary,
): number {
  const workspaceDelta = left.workspaceId.localeCompare(right.workspaceId);
  if (workspaceDelta !== 0) return workspaceDelta;
  const agentDelta = left.agentId.localeCompare(right.agentId);
  return agentDelta === 0
    ? left.suiteId.localeCompare(right.suiteId)
    : agentDelta;
}

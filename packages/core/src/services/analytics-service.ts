import { assertScope, type AuthSubject } from "@romeo/auth";
import type { BaseModel } from "@romeo/providers";

import type {
  Agent,
  EvalRun,
  EvalSuite,
  ToolCallRecord,
  UsageEvent,
  UsageSummaryMetric,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import type { JobOperationalSummary } from "./job-service";
import type { ProviderOperationalSummary } from "./provider-operational-summary";
import { overallStatus, summarizeJobs } from "./analytics-status";
import { countToolCall, emptyToolSummary } from "./analytics-tool-summary";
import {
  collectModelConfigAttention,
  isAnalyticsNoiseMetric,
  usageMetricQuantity,
} from "./model-config-attention";
import type {
  AdminAnalyticsEvalAgentSummary,
  AdminAnalyticsEvalModelSummary,
  AdminAnalyticsEvalSuiteSummary,
  AdminAnalyticsEvalSummary,
  AdminAnalyticsProviderSummary,
  AdminAnalyticsSummary,
  AdminAnalyticsToolSummary,
  AdminAnalyticsUsageSummary,
} from "./analytics-types";

export { formatAdminAnalyticsSummaryCsv } from "./analytics-csv";
export type * from "./analytics-types";

export class AnalyticsService {
  constructor(private readonly repository: RomeoRepository) {}

  async summary(
    subject: AuthSubject,
    input: {
      from?: string;
      jobSummary: JobOperationalSummary;
      providerSummary: ProviderOperationalSummary;
      to?: string;
    },
  ): Promise<AdminAnalyticsSummary> {
    assertScope(subject, "admin:read");
    assertScope(subject, "usage:read");
    const generatedAt = new Date().toISOString();
    const window = {
      from: input.from ?? null,
      to: input.to ?? generatedAt,
    };
    const [workspaces, usageEvents, toolCalls, models] = await Promise.all([
      this.repository.listWorkspaces(subject.orgId),
      this.repository.listUsageEvents(subject.orgId),
      this.repository.listToolCalls(subject.orgId),
      this.repository.listModels(subject.orgId),
    ]);
    const rangedUsage = usageEvents.filter((event) =>
      inWindow(event.createdAt, window.from, window.to),
    );
    const rangedTools = toolCalls.filter((call) =>
      inWindow(call.startedAt, window.from, window.to),
    );
    const agents = (
      await Promise.all(
        workspaces.map((workspace) => this.repository.listAgents(workspace.id)),
      )
    ).flat();
    const evals = await this.evalSummary(agents);
    const usage = summarizeUsage(rangedUsage, models);
    const providers = summarizeProviders(input.providerSummary);
    const tools = summarizeTools(rangedTools);
    const jobs = summarizeJobs(input.jobSummary);

    return {
      attention: { models: collectModelConfigAttention(models) },
      evals,
      generatedAt,
      jobs,
      orgId: subject.orgId,
      providers,
      window,
      redaction: {
        rawEvalInputsReturned: false,
        rawEvalOutputsReturned: false,
        rawJobPayloadsReturned: false,
        rawProviderConfigReturned: false,
        rawToolInputsReturned: false,
        rawUsageMetadataReturned: false,
      },
      status: overallStatus(evals, providers, jobs),
      tools,
      usage,
    };
  }

  private async evalSummary(
    agents: Agent[],
  ): Promise<AdminAnalyticsEvalSummary> {
    const agentSummaries: AdminAnalyticsEvalAgentSummary[] = [];
    const suiteSummaries: AdminAnalyticsEvalSuiteSummary[] = [];
    const [allSuites, allRuns] = await Promise.all([
      this.repository.listEvalSuitesForAgents(agents.map((agent) => agent.id)),
      this.repository.listEvalRunsForAgents(agents.map((agent) => agent.id)),
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

function summarizeUsage(
  events: UsageEvent[],
  models: readonly BaseModel[],
): AdminAnalyticsUsageSummary {
  const modelsById = new Map(models.map((model) => [model.id, model]));
  const totals = rollupUsage(events, modelsById, (event) => ({
    metric: event.metric,
    unit: event.unit,
  }));
  const activity = events.filter(
    (event) => !isAnalyticsNoiseMetric(event.metric),
  );
  const reportedTokens = usageMetricQuantity(
    events,
    "llm.total_token.reported",
  );
  const estimatedTokens =
    usageMetricQuantity(events, "llm.input_token.estimated") +
    usageMetricQuantity(events, "llm.output_token.estimated");
  return {
    activityEventCount: activity.length,
    byProvider: rollupUsage(
      events.filter((event) => typeof event.metadata.providerId === "string"),
      modelsById,
      (event) => ({
        metric: event.metric,
        providerId: String(event.metadata.providerId),
        unit: event.unit,
      }),
    ),
    eventCount: events.length,
    estimatedCostUsd: totals.reduce(
      (total, metric) => total + metric.estimatedCostUsd,
      0,
    ),
    runsCompleted: usageMetricQuantity(events, "run.completed"),
    runsFailed: usageMetricQuantity(events, "run.failed"),
    runsStarted: usageMetricQuantity(events, "run.started"),
    totalTokens: reportedTokens > 0 ? reportedTokens : estimatedTokens,
    totals,
    unpricedTokenQuantity: events
      .filter(
        (event) =>
          event.unit === "token" && usageCost(event, modelsById) === 0,
      )
      .reduce((total, event) => total + event.quantity, 0),
  };
}

function summarizeProviders(
  summary: ProviderOperationalSummary,
): AdminAnalyticsProviderSummary {
  const unavailableProviderCount = summary.providers.filter(
    (provider) => provider.status === "unavailable",
  ).length;
  const degradedProviderCount = summary.providers.filter(
    (provider) => provider.status === "degraded",
  ).length;
  return {
    alertCount: summary.alerts.length,
    availableProviderCount: summary.providers.filter(
      (provider) => provider.status === "available",
    ).length,
    criticalAlertCount: summary.alerts.filter(
      (alert) => alert.severity === "critical",
    ).length,
    degradedProviderCount,
    providerCount: summary.providers.length,
    status: summary.status,
    unavailableProviderCount,
  };
}

function summarizeTools(calls: ToolCallRecord[]): AdminAnalyticsToolSummary {
  const byTool = new Map<string, AdminAnalyticsToolSummary["byTool"][number]>();
  const totals = emptyToolSummary();
  for (const call of calls) {
    countToolCall(totals, call);
    const tool = byTool.get(call.toolId) ?? {
      approvalRequiredCount: 0,
      blockedCount: 0,
      failureCount: 0,
      pendingApprovalCount: 0,
      successCount: 0,
      toolId: call.toolId,
      totalCount: 0,
    };
    countToolCall(tool, call);
    byTool.set(call.toolId, tool);
  }
  return {
    ...totals,
    byTool: Array.from(byTool.values()).sort((left, right) => {
      const countDelta = right.totalCount - left.totalCount;
      return countDelta === 0
        ? left.toolId.localeCompare(right.toolId)
        : countDelta;
    }),
  };
}

function rollupUsage<T extends UsageSummaryMetric>(
  events: UsageEvent[],
  modelsById: ReadonlyMap<string, BaseModel>,
  keyFor: (event: UsageEvent) => Omit<T, "estimatedCostUsd" | "quantity">,
): T[] {
  const byKey = new Map<string, T>();
  for (const event of events) {
    const keyFields = keyFor(event);
    const key = JSON.stringify(keyFields);
    const current =
      byKey.get(key) ??
      ({ ...keyFields, estimatedCostUsd: 0, quantity: 0 } as T);
    current.quantity += event.quantity;
    current.estimatedCostUsd += usageCost(event, modelsById);
    byKey.set(key, current);
  }
  return Array.from(byKey.values()).sort((left, right) =>
    `${left.metric}:${left.unit}`.localeCompare(
      `${right.metric}:${right.unit}`,
    ),
  );
}

function usageCost(
  event: UsageEvent,
  modelsById: ReadonlyMap<string, BaseModel>,
): number {
  const recorded = event.metadata.estimatedCostUsd;
  if (typeof recorded === "number" && Number.isFinite(recorded)) return recorded;
  if (event.unit !== "token") return 0;
  const modelId =
    typeof event.metadata.modelId === "string"
      ? event.metadata.modelId
      : undefined;
  if (modelId === undefined) return 0;
  const model = modelsById.get(modelId);
  if (model?.pricing === undefined) return 0;
  if (event.metric.includes("input_token")) {
    return model.pricing.inputTokenUsd * event.quantity;
  }
  if (event.metric.includes("output_token")) {
    return model.pricing.outputTokenUsd * event.quantity;
  }
  return 0;
}

function inWindow(
  timestamp: string,
  from: string | null,
  to: string,
): boolean {
  if (timestamp > to) return false;
  return from === null || timestamp >= from;
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

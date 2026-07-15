import { assertScope, type AuthSubject } from "@romeo/auth";

import type {
  Agent,
  BackgroundJob,
  EvalRun,
  EvalSuite,
  ToolCallRecord,
  UsageEvent,
  UsageSummaryMetric,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import type { JobOperationalSummary } from "./job-service";
import type { ProviderOperationalSummary } from "./provider-operational-summary";

export type AdminAnalyticsStatus =
  | "critical"
  | "degraded"
  | "healthy"
  | "not_required";

export interface AdminAnalyticsEvalSuiteSummary {
  suiteId: string;
  agentId: string;
  workspaceId: string;
  latestRunId?: string;
  latestStatus: "failed" | "missing" | "passed";
  latestScore?: number;
  latestCompletedAt?: string;
  runCount: number;
}

export interface AdminAnalyticsEvalAgentSummary {
  agentId: string;
  workspaceId: string;
  latestCompletedAt?: string;
  latestRunId?: string;
  latestScore?: number;
  latestStatus: "failed" | "missing" | "not_required" | "passed";
  runCount: number;
  suiteCount: number;
}

export interface AdminAnalyticsEvalModelSummary {
  averageScore: number;
  failedRunCount: number;
  latestCompletedAt?: string;
  latestRunId?: string;
  modelId: string;
  passedRunCount: number;
  runCount: number;
}

export interface AdminAnalyticsEvalSummary {
  agentCount: number;
  agents: AdminAnalyticsEvalAgentSummary[];
  averageLatestScore: number | null;
  byModel: AdminAnalyticsEvalModelSummary[];
  failedSuiteCount: number;
  generatedRunCount: number;
  missingSuiteCount: number;
  passedSuiteCount: number;
  releaseGate: {
    failedSuiteCount: number;
    missingSuiteCount: number;
    requiredSuiteCount: number;
    status: "failed" | "missing" | "not_required" | "passed";
  };
  status: "failed" | "missing" | "not_required" | "passed";
  suiteCount: number;
  suites: AdminAnalyticsEvalSuiteSummary[];
}

export interface AdminAnalyticsUsageSummary {
  byProvider: Array<UsageSummaryMetric & { providerId: string }>;
  eventCount: number;
  estimatedCostUsd: number;
  totals: UsageSummaryMetric[];
}

export interface AdminAnalyticsProviderSummary {
  alertCount: number;
  availableProviderCount: number;
  criticalAlertCount: number;
  degradedProviderCount: number;
  providerCount: number;
  status: ProviderOperationalSummary["status"];
  unavailableProviderCount: number;
}

export interface AdminAnalyticsToolSummary {
  approvalRequiredCount: number;
  blockedCount: number;
  byTool: Array<{
    approvalRequiredCount: number;
    blockedCount: number;
    failureCount: number;
    pendingApprovalCount: number;
    successCount: number;
    toolId: string;
    totalCount: number;
  }>;
  failureCount: number;
  pendingApprovalCount: number;
  successCount: number;
  totalCount: number;
}

export interface AdminAnalyticsJobSummary {
  alertCount: number;
  completed: number;
  criticalAlertCount: number;
  deadLettered: number;
  failed: number;
  queued: number;
  running: number;
  status: JobOperationalSummary["status"];
  total: number;
}

export interface AdminAnalyticsSummary {
  evals: AdminAnalyticsEvalSummary;
  generatedAt: string;
  jobs: AdminAnalyticsJobSummary;
  orgId: string;
  providers: AdminAnalyticsProviderSummary;
  redaction: {
    rawEvalInputsReturned: false;
    rawEvalOutputsReturned: false;
    rawJobPayloadsReturned: false;
    rawProviderConfigReturned: false;
    rawToolInputsReturned: false;
    rawUsageMetadataReturned: false;
  };
  status: Exclude<AdminAnalyticsStatus, "not_required">;
  tools: AdminAnalyticsToolSummary;
  usage: AdminAnalyticsUsageSummary;
}

export class AnalyticsService {
  constructor(private readonly repository: RomeoRepository) {}

  async summary(
    subject: AuthSubject,
    input: {
      jobSummary: JobOperationalSummary;
      providerSummary: ProviderOperationalSummary;
    },
  ): Promise<AdminAnalyticsSummary> {
    assertScope(subject, "admin:read");
    assertScope(subject, "usage:read");
    const generatedAt = new Date().toISOString();
    const [workspaces, usageEvents, toolCalls] = await Promise.all([
      this.repository.listWorkspaces(subject.orgId),
      this.repository.listUsageEvents(subject.orgId),
      this.repository.listToolCalls(subject.orgId),
    ]);
    const agents = (
      await Promise.all(
        workspaces.map((workspace) => this.repository.listAgents(workspace.id)),
      )
    ).flat();
    const evals = await this.evalSummary(agents);
    const usage = summarizeUsage(usageEvents);
    const providers = summarizeProviders(input.providerSummary);
    const tools = summarizeTools(toolCalls);
    const jobs = summarizeJobs(input.jobSummary);

    return {
      evals,
      generatedAt,
      jobs,
      orgId: subject.orgId,
      providers,
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
    const allRuns: EvalRun[] = [];

    for (const agent of agents) {
      const [suites, runs] = await Promise.all([
        this.repository.listEvalSuites(agent.id),
        this.repository.listEvalRuns(agent.id),
      ]);
      allRuns.push(...runs);
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

export function formatAdminAnalyticsSummaryCsv(
  summary: AdminAnalyticsSummary,
): string {
  const rows: string[][] = [
    ["category", "dimension", "id", "metric", "value"],
    ["overall", "org", summary.orgId, "status", summary.status],
    ["eval", "org", summary.orgId, "status", summary.evals.status],
    [
      "eval",
      "org",
      summary.orgId,
      "suite_count",
      String(summary.evals.suiteCount),
    ],
    [
      "eval",
      "org",
      summary.orgId,
      "run_count",
      String(summary.evals.generatedRunCount),
    ],
    [
      "usage",
      "org",
      summary.orgId,
      "estimated_cost_usd",
      String(summary.usage.estimatedCostUsd),
    ],
    [
      "provider",
      "org",
      summary.orgId,
      "critical_alert_count",
      String(summary.providers.criticalAlertCount),
    ],
    [
      "job",
      "org",
      summary.orgId,
      "critical_alert_count",
      String(summary.jobs.criticalAlertCount),
    ],
    [
      "tool",
      "org",
      summary.orgId,
      "failure_count",
      String(summary.tools.failureCount),
    ],
  ];

  for (const suite of summary.evals.suites) {
    rows.push([
      "eval",
      "suite",
      suite.suiteId,
      "latest_status",
      suite.latestStatus,
    ]);
    if (suite.latestScore !== undefined) {
      rows.push([
        "eval",
        "suite",
        suite.suiteId,
        "latest_score",
        String(suite.latestScore),
      ]);
    }
  }
  for (const metric of summary.usage.totals) {
    rows.push([
      "usage",
      "metric",
      `${metric.metric}:${metric.unit}`,
      "quantity",
      String(metric.quantity),
    ]);
  }
  for (const tool of summary.tools.byTool) {
    rows.push([
      "tool",
      "tool",
      tool.toolId,
      "total_count",
      String(tool.totalCount),
    ]);
    rows.push([
      "tool",
      "tool",
      tool.toolId,
      "failure_count",
      String(tool.failureCount),
    ]);
  }

  return `${rows.map(formatCsvRow).join("\n")}\n`;
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
  const suiteSummaries = suites.map((suite) => summarizeSuite(agent, suite, runs));
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

function summarizeEvalModels(runs: EvalRun[]): AdminAnalyticsEvalModelSummary[] {
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

function summarizeUsage(events: UsageEvent[]): AdminAnalyticsUsageSummary {
  const totals = rollupUsage(events, (event) => ({
    metric: event.metric,
    unit: event.unit,
  }));
  return {
    byProvider: rollupUsage(
      events.filter((event) => typeof event.metadata.providerId === "string"),
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
    totals,
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
  const byTool = new Map<
    string,
    AdminAnalyticsToolSummary["byTool"][number]
  >();
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

function summarizeJobs(summary: JobOperationalSummary): AdminAnalyticsJobSummary {
  return {
    alertCount: summary.alerts.length,
    completed: summary.totals.completed,
    criticalAlertCount: summary.alerts.filter(
      (alert) => alert.severity === "critical",
    ).length,
    deadLettered: summary.totals.deadLettered,
    failed: summary.totals.failed,
    queued: summary.totals.queued,
    running: summary.totals.running,
    status: summary.status,
    total: summary.totals.total,
  };
}

function overallStatus(
  evals: AdminAnalyticsEvalSummary,
  providers: AdminAnalyticsProviderSummary,
  jobs: AdminAnalyticsJobSummary,
): Exclude<AdminAnalyticsStatus, "not_required"> {
  if (
    providers.status === "critical" ||
    jobs.status === "critical" ||
    evals.status === "failed"
  ) {
    return "critical";
  }
  if (
    providers.status === "degraded" ||
    jobs.status === "degraded" ||
    evals.status === "missing"
  ) {
    return "degraded";
  }
  return "healthy";
}

function rollupUsage<T extends UsageSummaryMetric>(
  events: UsageEvent[],
  keyFor: (event: UsageEvent) => Omit<T, "estimatedCostUsd" | "quantity">,
): T[] {
  const byKey = new Map<string, T>();
  for (const event of events) {
    const keyFields = keyFor(event);
    const key = JSON.stringify(keyFields);
    const current =
      byKey.get(key) ?? ({ ...keyFields, estimatedCostUsd: 0, quantity: 0 } as T);
    current.quantity += event.quantity;
    current.estimatedCostUsd += usageCost(event);
    byKey.set(key, current);
  }
  return Array.from(byKey.values()).sort((left, right) =>
    `${left.metric}:${left.unit}`.localeCompare(`${right.metric}:${right.unit}`),
  );
}

function usageCost(event: UsageEvent): number {
  const value = event.metadata.estimatedCostUsd;
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function emptyToolSummary(): Omit<AdminAnalyticsToolSummary, "byTool"> {
  return {
    approvalRequiredCount: 0,
    blockedCount: 0,
    failureCount: 0,
    pendingApprovalCount: 0,
    successCount: 0,
    totalCount: 0,
  };
}

function countToolCall(
  target: Omit<AdminAnalyticsToolSummary, "byTool">,
  call: ToolCallRecord,
): void {
  target.totalCount += 1;
  if (call.approvalRequired) target.approvalRequiredCount += 1;
  if (call.status === "approval_required") target.pendingApprovalCount += 1;
  if (call.status === "blocked") target.blockedCount += 1;
  if (call.status === "failure") target.failureCount += 1;
  if (call.status === "success") target.successCount += 1;
}

function compareRunsNewestFirst(left: EvalRun, right: EvalRun): number {
  const completedDelta = right.completedAt.localeCompare(left.completedAt);
  return completedDelta === 0 ? right.id.localeCompare(left.id) : completedDelta;
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

function formatCsvRow(row: string[]): string {
  return row.map(csvCell).join(",");
}

function csvCell(value: string): string {
  return /[",\n\r]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

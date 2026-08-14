import { assertScope, type AuthSubject } from "@romeo/auth";
import type { BaseModel } from "@romeo/providers";

import type {
  ToolCallRecord,
  UsageEvent,
  UsageSummaryMetric,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import type { JobOperationalSummary } from "./job-service";
import type { ProviderOperationalSummary } from "./provider-operational-summary";
import {
  isPriceableTokenUsageMetric,
  recordedUsageCostUsd,
  selectUsageCostEventIds,
} from "./usage-cost-reconciliation";
import { overallStatus, summarizeJobs } from "./analytics-status";
import { buildAnalyticsEvalSummary } from "./analytics-eval-summary";
import { countToolCall, emptyToolSummary } from "./analytics-tool-summary";
import {
  collectModelConfigAttention,
  isAnalyticsNoiseMetric,
  usageMetricQuantity,
} from "./model-config-attention";
import type {
  AdminAnalyticsAdoptionSummary,
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
    const evals = await buildAnalyticsEvalSummary(this.repository, agents);
    const usage = summarizeUsage(rangedUsage, models);
    const providers = summarizeProviders(input.providerSummary);
    const tools = summarizeTools(rangedTools);
    const jobs = summarizeJobs(input.jobSummary);

    return {
      adoption: summarizeAdoption(rangedUsage, usage, tools),
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
}

function summarizeAdoption(
  events: UsageEvent[],
  usage: AdminAnalyticsUsageSummary,
  tools: AdminAnalyticsToolSummary,
): AdminAnalyticsAdoptionSummary {
  const activity = events.filter(
    (event) =>
      !isAnalyticsNoiseMetric(event.metric) &&
      !event.actorId.startsWith("system_"),
  );
  const actorEventCounts = new Map<string, number>();
  for (const event of activity) {
    actorEventCounts.set(
      event.actorId,
      (actorEventCounts.get(event.actorId) ?? 0) + 1,
    );
  }
  const feedback = events.filter(
    (event) =>
      event.metric === "chat.message.feedback" &&
      event.quantity > 0 &&
      event.metadata.configured !== false,
  );
  const positiveCount = feedback.filter(
    (event) => event.metadata.rating === "positive",
  ).length;
  const negativeCount = feedback.filter(
    (event) => event.metadata.rating === "negative",
  ).length;
  const totalFeedback = positiveCount + negativeCount;
  const activeUserCount = actorEventCounts.size;
  const runTerminalCount = usage.runsCompleted + usage.runsFailed;
  const toolTerminalCount = tools.successCount + tools.failureCount;
  return {
    activeUserCount,
    activeWorkspaceCount: new Set(
      activity.flatMap((event) =>
        event.workspaceId === undefined ? [] : [event.workspaceId],
      ),
    ).size,
    engagedUserCount: Array.from(actorEventCounts.values()).filter(
      (count) => count >= 3,
    ).length,
    completedRunsPerActiveUser:
      activeUserCount === 0 ? 0 : usage.runsCompleted / activeUserCount,
    runCompletionRate:
      runTerminalCount === 0 ? null : usage.runsCompleted / runTerminalCount,
    toolSuccessRate:
      toolTerminalCount === 0 ? null : tools.successCount / toolTerminalCount,
    feedback: {
      negativeCount,
      positiveCount,
      positiveRate: totalFeedback === 0 ? null : positiveCount / totalFeedback,
      totalCount: totalFeedback,
    },
  };
}

function summarizeUsage(
  events: UsageEvent[],
  models: readonly BaseModel[],
): AdminAnalyticsUsageSummary {
  const modelsById = new Map(models.map((model) => [model.id, model]));
  const costEventIds = selectUsageCostEventIds(events);
  const totals = rollupUsage(events, modelsById, costEventIds, (event) => ({
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
  const reportedTokenParts =
    usageMetricQuantity(events, "llm.input_token.reported") +
    usageMetricQuantity(events, "llm.output_token.reported");
  const estimatedTokens =
    usageMetricQuantity(events, "llm.input_token.estimated") +
    usageMetricQuantity(events, "llm.output_token.estimated");
  return {
    activityEventCount: activity.length,
    byProvider: rollupUsage(
      events.filter((event) => typeof event.metadata.providerId === "string"),
      modelsById,
      costEventIds,
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
    totalTokens:
      reportedTokens > 0
        ? reportedTokens
        : reportedTokenParts > 0
          ? reportedTokenParts
          : estimatedTokens,
    totals,
    unpricedTokenQuantity: events
      .filter(
        (event) =>
          costEventIds.has(event.id) &&
          isPriceableTokenUsageMetric(event.metric) &&
          usageCost(event, modelsById, costEventIds) === 0,
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
  costEventIds: ReadonlySet<string>,
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
    current.estimatedCostUsd += usageCost(event, modelsById, costEventIds);
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
  costEventIds: ReadonlySet<string>,
): number {
  if (!costEventIds.has(event.id)) return 0;
  const recorded = recordedUsageCostUsd(event);
  if (recorded !== undefined) return recorded;
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

function inWindow(timestamp: string, from: string | null, to: string): boolean {
  if (timestamp > to) return false;
  return from === null || timestamp >= from;
}

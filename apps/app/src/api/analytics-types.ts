// Mirrors the backend admin analytics summary shapes defined in
// packages/core/src/services/analytics-service.ts. Field names and optionality
// are kept identical to the server response so the client stays type-safe.

export interface AdminAnalyticsUsageSummaryMetric {
  metric: string;
  quantity: number;
  unit: string;
  estimatedCostUsd: number;
}

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
  byProvider: Array<AdminAnalyticsUsageSummaryMetric & { providerId: string }>;
  eventCount: number;
  estimatedCostUsd: number;
  totals: AdminAnalyticsUsageSummaryMetric[];
}

export interface AdminAnalyticsProviderSummary {
  alertCount: number;
  availableProviderCount: number;
  criticalAlertCount: number;
  degradedProviderCount: number;
  providerCount: number;
  status: "critical" | "degraded" | "healthy";
  unavailableProviderCount: number;
}

export interface AdminAnalyticsToolSummaryRow {
  approvalRequiredCount: number;
  blockedCount: number;
  failureCount: number;
  pendingApprovalCount: number;
  successCount: number;
  toolId: string;
  totalCount: number;
}

export interface AdminAnalyticsToolSummary {
  approvalRequiredCount: number;
  blockedCount: number;
  byTool: AdminAnalyticsToolSummaryRow[];
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
  status: "critical" | "degraded" | "healthy";
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
  status: "critical" | "degraded" | "healthy";
  tools: AdminAnalyticsToolSummary;
  usage: AdminAnalyticsUsageSummary;
}

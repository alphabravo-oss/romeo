import type {
  AbuseControlPolicyReport,
  AdminAnalyticsSummary,
} from "@romeo/api-client/generated/sdk";

export type {
  AbuseControlPolicyReport,
  AbuseControlSimulationResult,
  AdminAnalyticsSummary,
  UpdateAbuseControlPolicyRequest,
  SimulateAbuseControlPolicyRequest,
} from "@romeo/api-client/generated/sdk";

export type AdminAnalyticsToolSummaryRow =
  AdminAnalyticsSummary["tools"]["byTool"][number];
export type AdminAnalyticsAttentionModel =
  AdminAnalyticsSummary["attention"]["models"][number];
export type AdminAnalyticsUsageMetric =
  AdminAnalyticsSummary["usage"]["totals"][number];
export type BillingStatus =
  AbuseControlPolicyReport["entitlements"]["allowedBillingStatuses"][number];

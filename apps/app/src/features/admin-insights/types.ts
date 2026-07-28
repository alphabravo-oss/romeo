import type {
  AbuseControlPolicyReport,
  AdminAnalyticsSummary,
} from "@romeo/api-client/generated/sdk";

export type {
  AbuseControlPolicyReport,
  AdminAnalyticsSummary,
  UpdateAbuseControlPolicyRequest,
} from "@romeo/api-client/generated/sdk";

export type AdminAnalyticsToolSummaryRow =
  AdminAnalyticsSummary["tools"]["byTool"][number];
export type BillingStatus =
  AbuseControlPolicyReport["entitlements"]["allowedBillingStatuses"][number];

import type {
  ApplyBillingPlanRequest,
  BillingEntitlementReport,
  BillingPlan,
  SyncExternalBillingEventRequest,
} from "@romeo/api-client/generated/sdk";

export type {
  BillingEntitlementReconciliationResult,
  BillingEntitlementReport,
  BillingLifecycleEnforcementResult,
  BillingLifecycleReport,
  BillingPlan,
  BillingPlanApplyResult,
} from "@romeo/api-client/generated/sdk";

export type ApplyBillingPlanInput = ApplyBillingPlanRequest;
export type SyncExternalBillingEventInput = SyncExternalBillingEventRequest;
export type BillingPlanStatus = BillingPlan["status"];
export type BillingPlanSource = BillingPlan["source"];
export type BillingPlanQuotaTemplate = BillingPlan["quotaTemplates"][number];
export type BillingQuotaMetric = BillingPlanQuotaTemplate["metric"];
export type BillingQuotaResetInterval =
  BillingPlanQuotaTemplate["resetInterval"];
export type ExternalBillingEventType =
  SyncExternalBillingEventRequest["eventType"];
export type BillingEntitlementQuotaReport =
  BillingEntitlementReport["quotas"][number];

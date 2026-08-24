export type QuotaMetricRecord =
  | "image.cost.micro_usd"
  | "image.generated"
  | "run.started"
  | "storage.byte"
  | "tool.call"
  | "web.search.request"
  | "web.url.fetch";
export type QuotaScopeTypeRecord =
  | "agent"
  | "api_key"
  | "org"
  | "provider"
  | "user"
  | "workspace";
export type QuotaResetIntervalRecord = "daily" | "monthly" | "none";
export type BillingPlanStatusRecord =
  | "active"
  | "canceled"
  | "past_due"
  | "trialing";
export type BillingPlanSourceRecord = "external" | "manual";

export interface RetentionPolicyRecord {
  auditLogRetentionDays: number;
  fileRetentionDays: number | null;
  orgId: string;
  runEventRetentionDays: number;
  updatedAt: string;
  updatedBy: string;
  userFileRetentionDays: Record<string, number | null>;
  workspaceFileRetentionDays: Record<string, number | null>;
}

export interface BillingPlanQuotaTemplateRecord {
  limit: number;
  metric: QuotaMetricRecord;
  resetInterval: QuotaResetIntervalRecord;
}

export interface BillingPlanRecord {
  code: string;
  createdAt: string;
  externalCustomerId?: string;
  externalSubscriptionId?: string;
  id: string;
  metadata: Record<string, unknown>;
  name: string;
  orgId: string;
  quotaTemplates: BillingPlanQuotaTemplateRecord[];
  source: BillingPlanSourceRecord;
  status: BillingPlanStatusRecord;
  updatedAt: string;
}

export interface BillingEventReceiptRecord {
  createdAt: string;
  eventId: string;
  eventType: string;
  id: string;
  occurredAt: string;
  orgId: string;
  provider: string;
  result: {
    plan: BillingPlanRecord;
    quotas: QuotaBucketRecord[];
  };
}

export interface QuotaBucketRecord {
  createdAt: string;
  id: string;
  limit: number;
  metric: QuotaMetricRecord;
  orgId: string;
  resetAt?: string;
  resetInterval: QuotaResetIntervalRecord;
  scopeId: string;
  scopeType: QuotaScopeTypeRecord;
  updatedAt: string;
  used: number;
}

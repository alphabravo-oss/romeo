export interface AuditLog {
  id: string;
  orgId: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  outcome: "success" | "failure";
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface UsageEvent {
  id: string;
  orgId: string;
  workspaceId?: string;
  actorId: string;
  sourceType: "chat" | "retrieval" | "run" | "tool" | "storage" | "voice";
  sourceId: string;
  metric: string;
  quantity: number;
  unit: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface UsageSummaryMetric {
  metric: string;
  quantity: number;
  unit: string;
  estimatedCostUsd: number;
}

export interface UsageSummary {
  totals: UsageSummaryMetric[];
  byActor: Array<UsageSummaryMetric & { actorId: string }>;
  byProvider: Array<UsageSummaryMetric & { providerId: string }>;
}

export interface UsageAlert {
  id: string;
  scopeType: QuotaBucket["scopeType"];
  scopeId: string;
  metric: string;
  used: number;
  limit: number;
  percentUsed: number;
  severity: "warning" | "critical" | "exceeded";
  resetAt?: string;
}

export type QuotaMetric =
  | "image.cost.micro_usd"
  | "image.generated"
  | "web.search.request"
  | "web.url.fetch"
  | "run.started"
  | "tool.call"
  | "storage.byte";

export interface BillingPlanQuotaTemplate {
  metric: QuotaMetric;
  limit: number;
  resetInterval: QuotaBucket["resetInterval"];
}

export interface BillingPlan {
  id: string;
  orgId: string;
  code: string;
  name: string;
  status: "active" | "canceled" | "past_due" | "trialing";
  source: "external" | "manual";
  quotaTemplates: BillingPlanQuotaTemplate[];
  metadata: Record<string, unknown>;
  externalCustomerId?: string;
  externalSubscriptionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BillingEventReceipt {
  id: string;
  orgId: string;
  provider: string;
  eventId: string;
  eventType: string;
  occurredAt: string;
  result: {
    plan: BillingPlan;
    quotas: QuotaBucket[];
  };
  createdAt: string;
}

export interface BackgroundJob {
  id: string;
  orgId: string;
  workspaceId?: string;
  type: string;
  status: "queued" | "running" | "completed" | "failed";
  payload: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface QuotaBucket {
  id: string;
  orgId: string;
  scopeType: "org" | "user" | "workspace" | "provider" | "agent" | "api_key";
  scopeId: string;
  metric: QuotaMetric;
  limit: number;
  used: number;
  resetInterval: "none" | "daily" | "monthly";
  resetAt?: string;
  createdAt: string;
  updatedAt: string;
}

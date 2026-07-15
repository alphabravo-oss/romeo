import type { BillingPlan } from "../domain/entities";

export interface BillingLifecycleInput {
  cancelAt?: string | undefined;
  canceledAt?: string | undefined;
  currentPeriodEndsAt?: string | undefined;
  pastDueGraceEndsAt?: string | undefined;
  trialEndsAt?: string | undefined;
}

export interface BillingLifecycleMetadata {
  cancelAt?: string | undefined;
  canceledAt?: string | undefined;
  currentPeriodEndsAt?: string | undefined;
  pastDueGraceEndsAt?: string | undefined;
  trialEndsAt?: string | undefined;
}

export type BillingLifecycleWarning =
  | "billing_plan_missing"
  | "cancel_at_reached"
  | "past_due_grace_expired"
  | "subscription_period_expired"
  | "trial_expired";

export type BillingLifecycleRecommendedAction =
  | "mark_canceled"
  | "mark_past_due"
  | "none";

export interface BillingLifecycleReport {
  orgId: string;
  generatedAt: string;
  status: "attention_required" | "healthy";
  billingPlanConfigured: boolean;
  warnings: BillingLifecycleWarning[];
  recommendedAction: BillingLifecycleRecommendedAction;
  lifecycle: BillingLifecycleMetadata;
  billingPlan?: {
    code: string;
    externalCustomerConfigured: boolean;
    externalSubscriptionConfigured: boolean;
    name: string;
    source: BillingPlan["source"];
    status: BillingPlan["status"];
    updatedAt: string;
  };
}

export interface BillingLifecycleEnforcementResult {
  before: BillingLifecycleReport;
  after: BillingLifecycleReport;
  action: {
    type: BillingLifecycleRecommendedAction;
    statusChanged: boolean;
    previousStatus?: BillingPlan["status"];
    newStatus?: BillingPlan["status"];
  };
}

export function mergeBillingLifecycleMetadata(
  existing: Record<string, unknown>,
  input: BillingLifecycleInput | undefined,
): Record<string, unknown> {
  const lifecycle = normalizeBillingLifecycleInput(input);
  if (Object.keys(lifecycle).length === 0) return existing;
  return {
    ...existing,
    billingLifecycle: {
      ...billingLifecycleFromMetadata(existing),
      ...lifecycle,
    },
  };
}

export function billingLifecycleFromMetadata(
  metadata: Record<string, unknown>,
): BillingLifecycleMetadata {
  const raw =
    typeof metadata.billingLifecycle === "object" &&
    metadata.billingLifecycle !== null
      ? (metadata.billingLifecycle as Record<string, unknown>)
      : {};
  return normalizeBillingLifecycleInput(raw);
}

export function buildBillingLifecycleReport(input: {
  generatedAt?: string;
  now?: Date;
  orgId: string;
  plan: BillingPlan | undefined;
}): BillingLifecycleReport {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  if (input.plan === undefined) {
    return {
      orgId: input.orgId,
      generatedAt,
      status: "attention_required",
      billingPlanConfigured: false,
      warnings: ["billing_plan_missing"],
      recommendedAction: "none",
      lifecycle: {},
    };
  }

  const lifecycle = billingLifecycleFromMetadata(input.plan.metadata);
  const warnings = lifecycleWarnings(
    input.plan,
    lifecycle,
    input.now ?? new Date(),
  );
  return {
    orgId: input.orgId,
    generatedAt,
    status: warnings.length === 0 ? "healthy" : "attention_required",
    billingPlanConfigured: true,
    warnings,
    recommendedAction: lifecycleRecommendedAction(warnings),
    lifecycle,
    billingPlan: {
      code: input.plan.code,
      name: input.plan.name,
      source: input.plan.source,
      status: input.plan.status,
      externalCustomerConfigured: input.plan.externalCustomerId !== undefined,
      externalSubscriptionConfigured:
        input.plan.externalSubscriptionId !== undefined,
      updatedAt: input.plan.updatedAt,
    },
  };
}

export function statusForLifecycleAction(
  action: BillingLifecycleRecommendedAction,
): BillingPlan["status"] | undefined {
  if (action === "mark_canceled") return "canceled";
  if (action === "mark_past_due") return "past_due";
  return undefined;
}

function normalizeBillingLifecycleInput(
  input: Record<string, unknown> | BillingLifecycleInput | undefined,
): BillingLifecycleMetadata {
  if (input === undefined) return {};
  return definedProperties({
    cancelAt: normalizeTimestamp(input.cancelAt),
    canceledAt: normalizeTimestamp(input.canceledAt),
    currentPeriodEndsAt: normalizeTimestamp(input.currentPeriodEndsAt),
    pastDueGraceEndsAt: normalizeTimestamp(input.pastDueGraceEndsAt),
    trialEndsAt: normalizeTimestamp(input.trialEndsAt),
  });
}

function lifecycleWarnings(
  plan: BillingPlan,
  lifecycle: BillingLifecycleMetadata,
  now: Date,
): BillingLifecycleWarning[] {
  const warnings = new Set<BillingLifecycleWarning>();
  if (plan.status !== "canceled" && isDue(lifecycle.cancelAt, now)) {
    warnings.add("cancel_at_reached");
  }
  if (plan.status === "past_due" && isDue(lifecycle.pastDueGraceEndsAt, now)) {
    warnings.add("past_due_grace_expired");
  }
  if (plan.status === "trialing" && isDue(lifecycle.trialEndsAt, now)) {
    warnings.add("trial_expired");
  }
  if (
    (plan.status === "active" || plan.status === "trialing") &&
    isDue(lifecycle.currentPeriodEndsAt, now)
  ) {
    warnings.add("subscription_period_expired");
  }
  return [...warnings].sort();
}

function lifecycleRecommendedAction(
  warnings: BillingLifecycleWarning[],
): BillingLifecycleRecommendedAction {
  if (
    warnings.includes("cancel_at_reached") ||
    warnings.includes("past_due_grace_expired")
  ) {
    return "mark_canceled";
  }
  if (
    warnings.includes("subscription_period_expired") ||
    warnings.includes("trial_expired")
  ) {
    return "mark_past_due";
  }
  return "none";
}

function isDue(value: string | undefined, now: Date): boolean {
  return value !== undefined && Date.parse(value) <= now.getTime();
}

function normalizeTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return undefined;
  return new Date(parsed).toISOString();
}

function definedProperties<T extends Record<string, unknown>>(value: T): T {
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) output[key] = entry;
  }
  return output as T;
}

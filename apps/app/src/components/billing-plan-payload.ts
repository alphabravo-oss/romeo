// Billing plan writes replace the stored plan rather than merging it. Keep the
// payload decision UI-free so every field the editor does not expose is
// demonstrably preserved, and so the quota array cannot collapse to the one
// hard-coded row that the old form happened to render.

export type BillingPlanStatus = "active" | "canceled" | "past_due" | "trialing";
export type BillingPlanSource = "external" | "manual";
export type BillingQuotaMetric =
  | "image.cost.micro_usd"
  | "image.generated"
  | "web.search.request"
  | "web.url.fetch"
  | "run.started"
  | "storage.byte"
  | "tool.call";
export type BillingQuotaResetInterval = "daily" | "monthly" | "none";

export interface BillingQuotaTemplate {
  metric: BillingQuotaMetric;
  limit: number;
  resetInterval: BillingQuotaResetInterval;
}

export interface BillingPlanSnapshot {
  code: string;
  name: string;
  status: BillingPlanStatus;
  source: BillingPlanSource;
  quotaTemplates: BillingQuotaTemplate[];
  metadata: Record<string, unknown>;
  externalCustomerId?: string;
  externalSubscriptionId?: string;
}

export interface BillingPlanFormValue {
  code: string;
  name: string;
  status: BillingPlanStatus;
  quotaTemplates: BillingQuotaTemplate[];
}

export function buildPlanDefaults(
  plan: BillingPlanSnapshot | null,
): BillingPlanFormValue {
  return {
    code: plan?.code ?? "",
    name: plan?.name ?? "",
    status: plan?.status ?? "active",
    quotaTemplates:
      plan?.quotaTemplates.map((template) => ({ ...template })) ?? [],
  };
}

export function buildApplyPayload(
  plan: BillingPlanSnapshot | null,
  formValue: Partial<BillingPlanFormValue>,
): BillingPlanFormValue & {
  source: BillingPlanSource;
  metadata: Record<string, unknown>;
  externalCustomerId?: string;
  externalSubscriptionId?: string;
} {
  const defaults = buildPlanDefaults(plan);
  return {
    ...defaults,
    ...formValue,
    quotaTemplates: (formValue.quotaTemplates ?? defaults.quotaTemplates).map(
      (template) => ({ ...template }),
    ),
    source: plan?.source ?? "manual",
    metadata: plan?.metadata ?? {},
    ...(plan?.externalCustomerId === undefined
      ? {}
      : { externalCustomerId: plan.externalCustomerId }),
    ...(plan?.externalSubscriptionId === undefined
      ? {}
      : { externalSubscriptionId: plan.externalSubscriptionId }),
  };
}

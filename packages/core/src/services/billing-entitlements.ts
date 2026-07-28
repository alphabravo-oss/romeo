import type { AuthSubject } from "@romeo/auth";

import type {
  BillingPlan,
  BillingPlanQuotaTemplate,
  QuotaBucket,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { createId } from "../ids";
import { nextResetAt } from "./quota-resets";

export type BillingEntitlementQuotaStatus =
  | "limit_and_reset_interval_mismatch"
  | "limit_mismatch"
  | "matched"
  | "missing"
  | "reset_interval_mismatch";

export interface BillingEntitlementQuotaReport {
  metric: BillingPlanQuotaTemplate["metric"];
  expectedLimit: number;
  expectedResetInterval: BillingPlanQuotaTemplate["resetInterval"];
  status: BillingEntitlementQuotaStatus;
  actualLimit?: number;
  actualResetInterval?: BillingPlanQuotaTemplate["resetInterval"];
  actualUsed?: number;
  quotaBucketId?: string;
  resetAt?: string;
}

export interface BillingEntitlementReport {
  orgId: string;
  generatedAt: string;
  status: "attention_required" | "healthy";
  billingPlanConfigured: boolean;
  quotaTemplateCount: number;
  unmanagedOrgQuotaCount: number;
  warnings: Array<
    | "billing_plan_missing"
    | "billing_status_not_entitled"
    | "quota_limit_mismatch"
    | "quota_missing"
    | "quota_reset_interval_mismatch"
  >;
  billingPlan?: {
    code: string;
    name: string;
    source: BillingPlan["source"];
    status: BillingPlan["status"];
    externalCustomerConfigured: boolean;
    externalSubscriptionConfigured: boolean;
    updatedAt: string;
  };
  quotas: BillingEntitlementQuotaReport[];
}

export interface BillingEntitlementReconciliationResult {
  before: BillingEntitlementReport;
  after: BillingEntitlementReport;
  actions: {
    createdQuotaIds: string[];
    updatedQuotaIds: string[];
    unchangedQuotaIds: string[];
  };
}

export async function applyBillingQuotaTemplates(
  repository: RomeoRepository,
  subject: AuthSubject,
  templates: BillingPlanQuotaTemplate[],
): Promise<QuotaBucket[]> {
  const existingBuckets = await repository.listQuotaBuckets(subject.orgId);
  const applied: QuotaBucket[] = [];
  for (const template of templates) {
    const existing = existingBuckets.find(
      (bucket) =>
        bucket.scopeType === "org" &&
        bucket.scopeId === subject.orgId &&
        bucket.metric === template.metric,
    );
    if (existing === undefined) {
      const resetAt = nextResetAt(template.resetInterval);
      const now = new Date().toISOString();
      const bucket: QuotaBucket = {
        id: createId("quota"),
        orgId: subject.orgId,
        scopeType: "org",
        scopeId: subject.orgId,
        metric: template.metric,
        limit: template.limit,
        used: 0,
        resetInterval: template.resetInterval,
        createdAt: now,
        updatedAt: now,
      };
      if (resetAt !== undefined) bucket.resetAt = resetAt;
      applied.push(await repository.createQuotaBucket(bucket));
      continue;
    }

    const resetAt =
      existing.resetInterval === template.resetInterval
        ? existing.resetAt
        : nextResetAt(template.resetInterval);
    const updated: QuotaBucket = {
      ...existing,
      limit: template.limit,
      resetInterval: template.resetInterval,
      updatedAt: new Date().toISOString(),
    };
    if (resetAt === undefined) delete updated.resetAt;
    else updated.resetAt = resetAt;
    applied.push(await repository.updateQuotaBucket(updated));
  }
  return applied;
}

export async function buildBillingEntitlementReport(
  repository: RomeoRepository,
  orgId: string,
): Promise<BillingEntitlementReport> {
  const [plan, buckets] = await Promise.all([
    repository.getBillingPlan(orgId),
    repository.listQuotaBuckets(orgId),
  ]);
  const generatedAt = new Date().toISOString();
  if (plan === undefined) {
    return {
      orgId,
      generatedAt,
      status: "attention_required",
      billingPlanConfigured: false,
      quotaTemplateCount: 0,
      unmanagedOrgQuotaCount: buckets.filter(
        (bucket) => bucket.scopeType === "org" && bucket.scopeId === orgId,
      ).length,
      warnings: ["billing_plan_missing"],
      quotas: [],
    };
  }

  const planMetrics = new Set(
    plan.quotaTemplates.map((template) => template.metric),
  );
  const orgBuckets = buckets.filter(
    (bucket) => bucket.scopeType === "org" && bucket.scopeId === orgId,
  );
  const quotas = plan.quotaTemplates.map((template) =>
    entitlementQuotaReport(
      template,
      orgBuckets.find((bucket) => bucket.metric === template.metric),
    ),
  );
  const warnings = entitlementWarnings(plan, quotas);
  return {
    orgId,
    generatedAt,
    status: warnings.length === 0 ? "healthy" : "attention_required",
    billingPlanConfigured: true,
    quotaTemplateCount: plan.quotaTemplates.length,
    unmanagedOrgQuotaCount: orgBuckets.filter(
      (bucket) => !planMetrics.has(bucket.metric),
    ).length,
    warnings,
    billingPlan: {
      code: plan.code,
      name: plan.name,
      source: plan.source,
      status: plan.status,
      externalCustomerConfigured: plan.externalCustomerId !== undefined,
      externalSubscriptionConfigured: plan.externalSubscriptionId !== undefined,
      updatedAt: plan.updatedAt,
    },
    quotas,
  };
}

export function validateBillingQuotaTemplates(
  templates: BillingPlanQuotaTemplate[],
): void {
  const seen = new Set<string>();
  for (const template of templates) {
    if (seen.has(template.metric)) {
      throw new ApiError(
        "billing_plan_duplicate_quota_metric",
        "Billing plan quota templates must have unique metrics.",
        400,
      );
    }
    seen.add(template.metric);
  }
}

function entitlementQuotaReport(
  template: BillingPlanQuotaTemplate,
  bucket: QuotaBucket | undefined,
): BillingEntitlementQuotaReport {
  if (bucket === undefined) {
    return {
      metric: template.metric,
      expectedLimit: template.limit,
      expectedResetInterval: template.resetInterval,
      status: "missing",
    };
  }

  const limitMismatch = bucket.limit !== template.limit;
  const resetMismatch = bucket.resetInterval !== template.resetInterval;
  const report: BillingEntitlementQuotaReport = {
    metric: template.metric,
    expectedLimit: template.limit,
    expectedResetInterval: template.resetInterval,
    status: entitlementQuotaStatus(limitMismatch, resetMismatch),
    actualLimit: bucket.limit,
    actualResetInterval: bucket.resetInterval,
    actualUsed: bucket.used,
    quotaBucketId: bucket.id,
  };
  if (bucket.resetAt !== undefined) report.resetAt = bucket.resetAt;
  return report;
}

function entitlementQuotaStatus(
  limitMismatch: boolean,
  resetMismatch: boolean,
): BillingEntitlementQuotaStatus {
  if (limitMismatch && resetMismatch) {
    return "limit_and_reset_interval_mismatch";
  }
  if (limitMismatch) return "limit_mismatch";
  if (resetMismatch) return "reset_interval_mismatch";
  return "matched";
}

function entitlementWarnings(
  plan: BillingPlan,
  quotas: BillingEntitlementQuotaReport[],
): BillingEntitlementReport["warnings"] {
  const warnings = new Set<BillingEntitlementReport["warnings"][number]>();
  if (plan.status === "canceled" || plan.status === "past_due") {
    warnings.add("billing_status_not_entitled");
  }
  for (const quota of quotas) {
    if (quota.status === "missing") warnings.add("quota_missing");
    if (
      quota.status === "limit_mismatch" ||
      quota.status === "limit_and_reset_interval_mismatch"
    ) {
      warnings.add("quota_limit_mismatch");
    }
    if (
      quota.status === "reset_interval_mismatch" ||
      quota.status === "limit_and_reset_interval_mismatch"
    ) {
      warnings.add("quota_reset_interval_mismatch");
    }
  }
  return [...warnings].sort();
}

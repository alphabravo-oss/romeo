import { assertScope, type AuthSubject } from "@romeo/auth";

import type {
  BillingPlan,
  BillingPlanQuotaTemplate,
  QuotaBucket,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { createId } from "../ids";
import {
  genericBillingWebhookEvent,
  stripeBillingWebhookEvent,
} from "./billing-provider-webhooks";
import {
  buildBillingLifecycleReport,
  mergeBillingLifecycleMetadata,
  statusForLifecycleAction,
  type BillingLifecycleEnforcementResult,
  type BillingLifecycleInput,
  type BillingLifecycleReport,
} from "./billing-lifecycle";
import { nextResetAt } from "./quota-resets";
import { ensureSystemAuditActor } from "./system-audit-actor";

export interface BillingPlanApplyResult {
  plan: BillingPlan;
  quotas: QuotaBucket[];
}

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

export interface ExternalBillingEventInput {
  amountCents?: number | undefined;
  currency?: string | undefined;
  eventType:
    | "customer.updated"
    | "invoice.paid"
    | "invoice.payment_failed"
    | "subscription.canceled"
    | "subscription.created"
    | "subscription.updated";
  externalCustomerId?: string | undefined;
  externalInvoiceId?: string | undefined;
  externalSubscriptionId?: string | undefined;
  invoiceStatus?: string | undefined;
  lifecycle?: BillingLifecycleInput | undefined;
  metadata?: Record<string, unknown> | undefined;
  occurredAt?: string | undefined;
  planCode?: string | undefined;
  planName?: string | undefined;
  provider: string;
  quotaTemplates?: BillingPlanQuotaTemplate[] | undefined;
  status?: BillingPlan["status"] | undefined;
}

export interface BillingServiceOptions {
  genericWebhookSecret?: string;
  genericWebhookToleranceSeconds?: number;
  stripeWebhookSecret?: string;
  stripeWebhookToleranceSeconds?: number;
  webhookOrgId?: string;
}

export class BillingService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly options: BillingServiceOptions = {},
  ) {}

  current(subject: AuthSubject): Promise<BillingPlan | undefined> {
    assertScope(subject, "admin:read");
    return this.repository.getBillingPlan(subject.orgId);
  }

  async entitlementReport(
    subject: AuthSubject,
  ): Promise<BillingEntitlementReport> {
    assertScope(subject, "admin:read");
    return this.buildEntitlementReport(this.repository, subject.orgId);
  }

  async reconcileEntitlements(
    subject: AuthSubject,
  ): Promise<BillingEntitlementReconciliationResult> {
    assertScope(subject, "admin:write");
    const before = await this.buildEntitlementReport(
      this.repository,
      subject.orgId,
    );
    if (!before.billingPlanConfigured) {
      await this.repository.createAuditLog({
        id: createId("audit"),
        orgId: subject.orgId,
        actorId: subject.id,
        action: "billing.entitlements_reconciled",
        resourceType: "billing_plan",
        resourceId: subject.orgId,
        outcome: "success",
        metadata: {
          billingPlanConfigured: false,
          createdQuotaCount: 0,
          updatedQuotaCount: 0,
          unchangedQuotaCount: 0,
          warnings: before.warnings,
        },
        createdAt: new Date().toISOString(),
      });
      return {
        before,
        after: before,
        actions: {
          createdQuotaIds: [],
          updatedQuotaIds: [],
          unchangedQuotaIds: [],
        },
      };
    }

    const plan = await this.repository.getBillingPlan(subject.orgId);
    if (plan === undefined) {
      throw new ApiError(
        "billing_plan_required",
        "Billing entitlement reconciliation requires a billing plan.",
        400,
      );
    }

    const missingMetrics = new Set(
      before.quotas
        .filter((quota) => quota.status === "missing")
        .map((quota) => quota.metric),
    );
    const mismatchedMetrics = new Set(
      before.quotas
        .filter(
          (quota) => quota.status !== "matched" && quota.status !== "missing",
        )
        .map((quota) => quota.metric),
    );

    const reconciled = await this.repository.transaction(async (repository) => {
      const txPlan = await repository.getBillingPlan(subject.orgId);
      if (txPlan === undefined) {
        throw new ApiError(
          "billing_plan_required",
          "Billing entitlement reconciliation requires a billing plan.",
          400,
        );
      }
      const applied = await this.applyQuotaTemplates(
        repository,
        subject,
        txPlan.quotaTemplates,
      );
      const after = await this.buildEntitlementReport(
        repository,
        subject.orgId,
      );
      const createdQuotaIds = applied
        .filter((quota) => missingMetrics.has(quota.metric))
        .map((quota) => quota.id);
      const updatedQuotaIds = applied
        .filter((quota) => mismatchedMetrics.has(quota.metric))
        .map((quota) => quota.id);
      const unchangedQuotaIds = applied
        .filter(
          (quota) =>
            !missingMetrics.has(quota.metric) &&
            !mismatchedMetrics.has(quota.metric),
        )
        .map((quota) => quota.id);

      await repository.createAuditLog({
        id: createId("audit"),
        orgId: subject.orgId,
        actorId: subject.id,
        action: "billing.entitlements_reconciled",
        resourceType: "billing_plan",
        resourceId: txPlan.id,
        outcome: "success",
        metadata: {
          billingPlanConfigured: true,
          planCode: txPlan.code,
          planStatus: txPlan.status,
          createdQuotaCount: createdQuotaIds.length,
          updatedQuotaCount: updatedQuotaIds.length,
          unchangedQuotaCount: unchangedQuotaIds.length,
          beforeWarnings: before.warnings,
          afterWarnings: after.warnings,
        },
        createdAt: new Date().toISOString(),
      });
      return { after, createdQuotaIds, updatedQuotaIds, unchangedQuotaIds };
    });

    return {
      before,
      after: reconciled.after,
      actions: {
        createdQuotaIds: reconciled.createdQuotaIds,
        updatedQuotaIds: reconciled.updatedQuotaIds,
        unchangedQuotaIds: reconciled.unchangedQuotaIds,
      },
    };
  }

  async applyPlan(input: {
    subject: AuthSubject;
    code: string;
    name: string;
    status: BillingPlan["status"];
    source: BillingPlan["source"];
    quotaTemplates: BillingPlanQuotaTemplate[];
    metadata: Record<string, unknown>;
    externalCustomerId?: string;
    externalSubscriptionId?: string;
    lifecycle?: BillingLifecycleInput;
  }): Promise<BillingPlanApplyResult> {
    assertScope(input.subject, "admin:write");
    validateQuotaTemplates(input.quotaTemplates);
    return this.repository.transaction(async (repository) =>
      this.applyPlanInRepository(repository, input),
    );
  }

  async syncExternalEvent(input: {
    subject: AuthSubject;
    event: ExternalBillingEventInput;
  }): Promise<BillingPlanApplyResult> {
    assertScope(input.subject, "admin:write");
    return this.repository.transaction(async (repository) => {
      const existing = await repository.getBillingPlan(input.subject.orgId);
      const quotaTemplates =
        input.event.quotaTemplates ?? existing?.quotaTemplates ?? [];
      validateQuotaTemplates(quotaTemplates);
      if (quotaTemplates.length === 0)
        throw new ApiError(
          "billing_plan_required",
          "External billing sync requires quota templates or an existing billing plan.",
          400,
        );

      const code = input.event.planCode ?? existing?.code;
      const name = input.event.planName ?? existing?.name;
      if (code === undefined || name === undefined) {
        throw new ApiError(
          "billing_plan_required",
          "External billing sync requires plan code and name before a plan exists.",
          400,
        );
      }

      const externalCustomerId =
        input.event.externalCustomerId ?? existing?.externalCustomerId;
      const externalSubscriptionId =
        input.event.externalSubscriptionId ?? existing?.externalSubscriptionId;
      const applyInput: Parameters<BillingService["applyPlan"]>[0] = {
        subject: input.subject,
        code,
        name,
        status:
          input.event.status ??
          statusFromExternalEvent(input.event.eventType, existing?.status),
        source: "external",
        quotaTemplates,
        metadata: externalBillingMetadata(
          existing?.metadata ?? {},
          input.event,
        ),
      };
      if (input.event.lifecycle !== undefined)
        applyInput.lifecycle = input.event.lifecycle;
      if (externalCustomerId !== undefined)
        applyInput.externalCustomerId = externalCustomerId;
      if (externalSubscriptionId !== undefined)
        applyInput.externalSubscriptionId = externalSubscriptionId;
      const result = await this.applyPlanInRepository(repository, applyInput);

      await repository.createAuditLog({
        id: createId("audit"),
        orgId: input.subject.orgId,
        actorId: input.subject.id,
        action: "billing.external_event_synced",
        resourceType: "billing_plan",
        resourceId: result.plan.id,
        outcome: "success",
        metadata: {
          provider: input.event.provider,
          eventType: input.event.eventType,
          status: result.plan.status,
          hasInvoice: input.event.externalInvoiceId !== undefined,
          hasSubscription: result.plan.externalSubscriptionId !== undefined,
        },
        createdAt: new Date().toISOString(),
      });
      return result;
    });
  }

  async syncStripeWebhook(input: {
    payload: string;
    signatureHeader: string | undefined;
  }): Promise<BillingPlanApplyResult> {
    const event = stripeBillingWebhookEvent({
      payload: input.payload,
      signatureHeader: input.signatureHeader,
      secret: this.options.stripeWebhookSecret ?? "",
      toleranceSeconds: this.options.stripeWebhookToleranceSeconds ?? 300,
    });
    const orgId = this.options.webhookOrgId ?? "org_default";
    return this.syncExternalEvent({
      subject: await billingWebhookSubject(this.repository, orgId),
      event,
    });
  }

  async syncGenericWebhook(input: {
    payload: string;
    signatureHeader: string | undefined;
    timestampHeader: string | undefined;
  }): Promise<BillingPlanApplyResult> {
    const event = genericBillingWebhookEvent({
      payload: input.payload,
      signatureHeader: input.signatureHeader,
      timestampHeader: input.timestampHeader,
      secret: this.options.genericWebhookSecret ?? "",
      toleranceSeconds: this.options.genericWebhookToleranceSeconds ?? 300,
    });
    const orgId = this.options.webhookOrgId ?? "org_default";
    return this.syncExternalEvent({
      subject: await billingWebhookSubject(this.repository, orgId),
      event,
    });
  }

  async lifecycleReport(subject: AuthSubject): Promise<BillingLifecycleReport> {
    assertScope(subject, "admin:read");
    return this.buildLifecycleReport(subject.orgId);
  }

  async enforceLifecycle(
    subject: AuthSubject,
  ): Promise<BillingLifecycleEnforcementResult> {
    assertScope(subject, "admin:write");
    return this.repository.transaction(async (repository) => {
      const plan = await repository.getBillingPlan(subject.orgId);
      const before = buildBillingLifecycleReport({
        orgId: subject.orgId,
        plan,
      });
      const nextStatus = statusForLifecycleAction(before.recommendedAction);
      const statusChanged =
        plan !== undefined &&
        nextStatus !== undefined &&
        plan.status !== nextStatus;
      const now = new Date().toISOString();
      const effectivePlan = statusChanged
        ? await repository.upsertBillingPlan({
            ...plan,
            status: nextStatus,
            metadata: {
              ...plan.metadata,
              billingLifecycleLastAction: before.recommendedAction,
              billingLifecycleLastEnforcedAt: now,
            },
            updatedAt: now,
          })
        : plan;
      const after = buildBillingLifecycleReport({
        orgId: subject.orgId,
        plan: effectivePlan,
      });
      await repository.createAuditLog({
        id: createId("audit"),
        orgId: subject.orgId,
        actorId: subject.id,
        action: "billing.lifecycle_enforced",
        resourceType: "billing_plan",
        resourceId: plan?.id ?? subject.orgId,
        outcome: "success",
        metadata: {
          billingPlanConfigured: plan !== undefined,
          action: before.recommendedAction,
          statusChanged,
          previousStatus: plan?.status ?? null,
          newStatus: statusChanged ? nextStatus : (plan?.status ?? null),
          warnings: before.warnings,
        },
        createdAt: now,
      });
      return {
        before,
        after,
        action: {
          type: before.recommendedAction,
          statusChanged,
          ...(plan === undefined ? {} : { previousStatus: plan.status }),
          ...(statusChanged && nextStatus !== undefined
            ? { newStatus: nextStatus }
            : plan === undefined
              ? {}
              : { newStatus: plan.status }),
        },
      };
    });
  }

  private async applyPlanInRepository(
    repository: RomeoRepository,
    input: Parameters<BillingService["applyPlan"]>[0],
  ): Promise<BillingPlanApplyResult> {
    const existing = await repository.getBillingPlan(input.subject.orgId);
    const now = new Date().toISOString();
    const plan: BillingPlan = {
      id: existing?.id ?? createId("billing_plan"),
      orgId: input.subject.orgId,
      code: input.code,
      name: input.name,
      status: input.status,
      source: input.source,
      quotaTemplates: input.quotaTemplates,
      metadata: mergeBillingLifecycleMetadata(input.metadata, input.lifecycle),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (input.externalCustomerId !== undefined)
      plan.externalCustomerId = input.externalCustomerId;
    if (input.externalSubscriptionId !== undefined)
      plan.externalSubscriptionId = input.externalSubscriptionId;

    const storedPlan = await repository.upsertBillingPlan(plan);
    const quotas = await this.applyQuotaTemplates(
      repository,
      input.subject,
      storedPlan.quotaTemplates,
    );
    await repository.createAuditLog({
      id: createId("audit"),
      orgId: input.subject.orgId,
      actorId: input.subject.id,
      action: "billing.plan_applied",
      resourceType: "billing_plan",
      resourceId: storedPlan.id,
      outcome: "success",
      metadata: {
        code: storedPlan.code,
        status: storedPlan.status,
        source: storedPlan.source,
        quotaTemplateCount: storedPlan.quotaTemplates.length,
        quotaIds: quotas.map((quota) => quota.id),
      },
      createdAt: now,
    });
    return { plan: storedPlan, quotas };
  }

  private async applyQuotaTemplates(
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
        const bucket: QuotaBucket = {
          id: createId("quota"),
          orgId: subject.orgId,
          scopeType: "org",
          scopeId: subject.orgId,
          metric: template.metric,
          limit: template.limit,
          used: 0,
          resetInterval: template.resetInterval,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
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

  private async buildEntitlementReport(
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
        externalSubscriptionConfigured:
          plan.externalSubscriptionId !== undefined,
        updatedAt: plan.updatedAt,
      },
      quotas,
    };
  }

  private async buildLifecycleReport(
    orgId: string,
  ): Promise<BillingLifecycleReport> {
    const plan = await this.repository.getBillingPlan(orgId);
    return buildBillingLifecycleReport({ orgId, plan });
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
  if (limitMismatch && resetMismatch)
    return "limit_and_reset_interval_mismatch";
  if (limitMismatch) return "limit_mismatch";
  if (resetMismatch) return "reset_interval_mismatch";
  return "matched";
}

function entitlementWarnings(
  plan: BillingPlan,
  quotas: BillingEntitlementQuotaReport[],
): BillingEntitlementReport["warnings"] {
  const warnings = new Set<BillingEntitlementReport["warnings"][number]>();
  if (plan.status === "canceled" || plan.status === "past_due")
    warnings.add("billing_status_not_entitled");
  for (const quota of quotas) {
    if (quota.status === "missing") warnings.add("quota_missing");
    if (
      quota.status === "limit_mismatch" ||
      quota.status === "limit_and_reset_interval_mismatch"
    )
      warnings.add("quota_limit_mismatch");
    if (
      quota.status === "reset_interval_mismatch" ||
      quota.status === "limit_and_reset_interval_mismatch"
    )
      warnings.add("quota_reset_interval_mismatch");
  }
  return [...warnings].sort();
}

async function billingWebhookSubject(
  repository: RomeoRepository,
  orgId: string,
): Promise<AuthSubject> {
  const actor = await ensureSystemAuditActor(repository, {
    kind: "billing_webhook",
    name: "Romeo system billing webhook",
    orgId,
  });
  return {
    id: actor.id,
    type: "service_account",
    orgId,
    workspaceIds: [],
    groupIds: [],
    scopes: ["admin:write"],
    isAdmin: true,
  };
}

function statusFromExternalEvent(
  eventType: ExternalBillingEventInput["eventType"],
  fallback: BillingPlan["status"] | undefined,
): BillingPlan["status"] {
  if (eventType === "subscription.canceled") return "canceled";
  if (eventType === "invoice.payment_failed") return "past_due";
  if (
    eventType === "subscription.created" ||
    eventType === "subscription.updated" ||
    eventType === "invoice.paid"
  )
    return fallback === "trialing" ? "trialing" : "active";
  return fallback ?? "active";
}

function externalBillingMetadata(
  existing: Record<string, unknown>,
  event: ExternalBillingEventInput,
): Record<string, unknown> {
  return {
    ...existing,
    billingProvider: event.provider,
    lastExternalEventType: event.eventType,
    lastExternalEventAt: event.occurredAt ?? new Date().toISOString(),
    ...(event.externalInvoiceId === undefined
      ? {}
      : {
          lastInvoice: {
            externalInvoiceId: event.externalInvoiceId,
            ...(event.invoiceStatus === undefined
              ? {}
              : { status: event.invoiceStatus }),
            ...(event.amountCents === undefined
              ? {}
              : { amountCents: event.amountCents }),
            ...(event.currency === undefined
              ? {}
              : { currency: event.currency }),
          },
        }),
    ...(event.metadata === undefined
      ? {}
      : {
          externalMetadataKeys: Object.keys(event.metadata).sort().slice(0, 25),
        }),
  };
}

function validateQuotaTemplates(templates: BillingPlanQuotaTemplate[]): void {
  const seen = new Set<string>();
  for (const template of templates) {
    if (seen.has(template.metric))
      throw new ApiError(
        "billing_plan_duplicate_quota_metric",
        "Billing plan quota templates must have unique metrics.",
        400,
      );
    seen.add(template.metric);
  }
}

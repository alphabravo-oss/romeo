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
  billingWebhookSubject,
  externalBillingMetadata,
  statusFromExternalEvent,
  type ExternalBillingEventInput,
} from "./billing-external-events";
import {
  applyBillingQuotaTemplates,
  buildBillingEntitlementReport,
  validateBillingQuotaTemplates,
  type BillingEntitlementReconciliationResult,
  type BillingEntitlementReport,
} from "./billing-entitlements";
import { reconcileBillingEntitlements } from "./billing-entitlement-reconciliation";
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

export * from "./billing-entitlements";
export * from "./billing-external-events";

export interface BillingPlanApplyResult {
  plan: BillingPlan;
  quotas: QuotaBucket[];
}

export interface BillingServiceOptions {
  genericWebhookSecret?: string;
  genericWebhookToleranceSeconds?: number;
  stripeWebhookSecret?: string;
  stripeWebhookToleranceSeconds?: number;
  webhookOrgId?: string;
}

export class BillingService {
  private readonly syncTails = new Map<string, Promise<void>>();

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
    return buildBillingEntitlementReport(this.repository, subject.orgId);
  }

  async reconcileEntitlements(
    subject: AuthSubject,
  ): Promise<BillingEntitlementReconciliationResult> {
    assertScope(subject, "admin:write");
    return reconcileBillingEntitlements(this.repository, subject);
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
    validateBillingQuotaTemplates(input.quotaTemplates);
    return this.repository.transaction(async (repository) =>
      this.applyPlanInRepository(repository, input),
    );
  }

  async syncExternalEvent(input: {
    subject: AuthSubject;
    event: ExternalBillingEventInput;
  }): Promise<BillingPlanApplyResult> {
    assertScope(input.subject, "admin:write");
    return this.withSyncLock(input.subject.orgId, () =>
      this.repository.transaction(async (repository) => {
        await repository.acquireBillingSyncLock(input.subject.orgId);
        const priorReceipt = await repository.getBillingEventReceipt(
          input.subject.orgId,
          input.event.provider,
          input.event.eventId,
        );
        if (priorReceipt !== undefined) return priorReceipt.result;

        const existing = await repository.getBillingPlan(input.subject.orgId);
        const existingEventAt = externalEventTimestamp(existing?.metadata);
        if (
          existing !== undefined &&
          existingEventAt !== undefined &&
          Date.parse(input.event.occurredAt) < Date.parse(existingEventAt)
        ) {
          const result = {
            plan: existing,
            quotas: await repository.listQuotaBuckets(input.subject.orgId),
          };
          await repository.createBillingEventReceipt({
            id: createId("billing_event"),
            orgId: input.subject.orgId,
            provider: input.event.provider,
            eventId: input.event.eventId,
            eventType: input.event.eventType,
            occurredAt: input.event.occurredAt,
            result,
            createdAt: new Date().toISOString(),
          });
          await writeAuditLog(repository, {
            id: createId("audit"),
            orgId: input.subject.orgId,
            actorId: input.subject.id,
            action: "billing.external_event_ignored",
            resourceType: "billing_plan",
            resourceId: existing.id,
            outcome: "success",
            metadata: {
              provider: input.event.provider,
              eventType: input.event.eventType,
              reason: "older_than_last_applied_event",
            },
            createdAt: new Date().toISOString(),
          });
          return result;
        }
        const quotaTemplates =
          input.event.quotaTemplates ?? existing?.quotaTemplates ?? [];
        validateBillingQuotaTemplates(quotaTemplates);
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
          input.event.externalSubscriptionId ??
          existing?.externalSubscriptionId;
        const applyInput: Parameters<BillingService["applyPlan"]>[0] = {
          subject: input.subject,
          code,
          name,
          status:
            input.event.eventType === "invoice.paid" &&
            existing?.status === "canceled"
              ? "canceled"
              : (input.event.status ??
                statusFromExternalEvent(
                  input.event.eventType,
                  existing?.status,
                )),
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

        await writeAuditLog(repository, {
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
        await repository.createBillingEventReceipt({
          id: createId("billing_event"),
          orgId: input.subject.orgId,
          provider: input.event.provider,
          eventId: input.event.eventId,
          eventType: input.event.eventType,
          occurredAt: input.event.occurredAt,
          result,
          createdAt: new Date().toISOString(),
        });
        return result;
      }),
    );
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
      await writeAuditLog(repository, {
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
    const quotas = await applyBillingQuotaTemplates(
      repository,
      input.subject,
      storedPlan.quotaTemplates,
    );
    await writeAuditLog(repository, {
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

  private async buildLifecycleReport(
    orgId: string,
  ): Promise<BillingLifecycleReport> {
    const plan = await this.repository.getBillingPlan(orgId);
    return buildBillingLifecycleReport({ orgId, plan });
  }

  private async withSyncLock<T>(
    orgId: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const prior = this.syncTails.get(orgId) ?? Promise.resolve();
    let release!: () => void;
    const tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.syncTails.set(orgId, tail);
    await prior;
    try {
      return await work();
    } finally {
      release();
      if (this.syncTails.get(orgId) === tail) this.syncTails.delete(orgId);
    }
  }
}

function externalEventTimestamp(
  metadata: Record<string, unknown> | undefined,
): string | undefined {
  const value = metadata?.lastExternalEventAt;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    return undefined;
  return value;
}
import { writeAuditLog } from "./audit-log";

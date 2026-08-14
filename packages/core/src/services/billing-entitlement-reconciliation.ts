import type { AuthSubject } from "@romeo/auth";

import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { createId } from "../ids";
import {
  applyBillingQuotaTemplates,
  buildBillingEntitlementReport,
  type BillingEntitlementReconciliationResult,
} from "./billing-entitlements";

export async function reconcileBillingEntitlements(
  repository: RomeoRepository,
  subject: AuthSubject,
): Promise<BillingEntitlementReconciliationResult> {
  const before = await buildBillingEntitlementReport(repository, subject.orgId);
  if (!before.billingPlanConfigured) {
    await writeAuditLog(repository, {
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

  const plan = await repository.getBillingPlan(subject.orgId);
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

  const reconciled = await repository.transaction(async (transaction) => {
    const transactionPlan = await transaction.getBillingPlan(subject.orgId);
    if (transactionPlan === undefined) {
      throw new ApiError(
        "billing_plan_required",
        "Billing entitlement reconciliation requires a billing plan.",
        400,
      );
    }
    const applied = await applyBillingQuotaTemplates(
      transaction,
      subject,
      transactionPlan.quotaTemplates,
    );
    const after = await buildBillingEntitlementReport(
      transaction,
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

    await writeAuditLog(transaction, {
      id: createId("audit"),
      orgId: subject.orgId,
      actorId: subject.id,
      action: "billing.entitlements_reconciled",
      resourceType: "billing_plan",
      resourceId: transactionPlan.id,
      outcome: "success",
      metadata: {
        billingPlanConfigured: true,
        planCode: transactionPlan.code,
        planStatus: transactionPlan.status,
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
import { writeAuditLog } from "./audit-log";

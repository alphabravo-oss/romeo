import type {
  AbuseControlBlockReason,
  AbuseControlKillSwitches,
  AbuseControlPolicyReport,
  UpdateAbuseControlPolicyRequest,
} from "../domain/abuse-controls";
import type { BillingPlan } from "../domain/entities";
import type { StoredAbuseControlPolicy } from "./abuse-control-types";

const settingKeyPrefix = "abuse_controls.org.v1:";

export function isEmptyPatch(policy: UpdateAbuseControlPolicyRequest): boolean {
  return (
    policy.suspension === undefined &&
    policy.entitlements === undefined &&
    policy.killSwitches === undefined
  );
}

export function cloneKillSwitches(
  killSwitches: AbuseControlKillSwitches,
): AbuseControlKillSwitches {
  return {
    connectorIds: [...killSwitches.connectorIds],
    providerIds: [...killSwitches.providerIds],
    toolIds: [...killSwitches.toolIds],
    workerClasses: [...killSwitches.workerClasses],
  };
}

export function settingKey(orgId: string): string {
  return `${settingKeyPrefix}${orgId}`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function defaultBlockReasonsFor(
  policy: StoredAbuseControlPolicy,
  billingPlan: BillingPlan | undefined,
): AbuseControlBlockReason[] {
  const reasons: AbuseControlBlockReason[] = [];
  if (policy.suspension.suspended) reasons.push("org_suspended");
  if (policy.entitlements.enforceBillingStatus) {
    if (
      billingPlan === undefined &&
      policy.entitlements.denyWhenBillingPlanMissing
    ) {
      reasons.push("billing_plan_missing");
    }
    if (
      billingPlan !== undefined &&
      !policy.entitlements.allowedBillingStatuses.includes(billingPlan.status)
    ) {
      reasons.push("billing_status_blocked");
    }
  }
  return reasons;
}

export function uniqueReasons(
  reasons: AbuseControlBlockReason[],
): AbuseControlBlockReason[] {
  return [...new Set(reasons)];
}

export function policyAuditMetadata(
  previous: AbuseControlPolicyReport,
  next: AbuseControlPolicyReport,
): Record<string, unknown> {
  return {
    suspended: next.suspension.suspended,
    suspensionChanged:
      previous.suspension.suspended !== next.suspension.suspended,
    reasonCodeChanged:
      (previous.suspension.reasonCode ?? null) !==
      (next.suspension.reasonCode ?? null),
    enforceBillingStatus: next.entitlements.enforceBillingStatus,
    denyWhenBillingPlanMissing: next.entitlements.denyWhenBillingPlanMissing,
    allowedBillingStatuses: next.entitlements.allowedBillingStatuses,
    killSwitchCounts: {
      connectorIds: next.killSwitches.connectorIds.length,
      providerIds: next.killSwitches.providerIds.length,
      toolIds: next.killSwitches.toolIds.length,
      workerClasses: next.killSwitches.workerClasses.length,
    },
    costWorkBlocked: next.enforcement.costWorkBlocked,
    defaultBlockReasons: next.enforcement.defaultBlockReasons,
  };
}

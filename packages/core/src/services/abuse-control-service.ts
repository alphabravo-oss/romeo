import { assertScope, type AuthSubject } from "@romeo/auth";

import type {
  AbuseControlAction,
  AbuseControlBlockReason,
  AbuseControlEntitlements,
  AbuseControlKillSwitches,
  AbuseControlPolicyReport,
  AbuseControlSuspension,
  UpdateAbuseControlPolicyRequest,
} from "../domain/abuse-controls";
import type { BillingPlan } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { writeAuditLog } from "./audit-log";

const settingKeyPrefix = "abuse_controls.org.v1:";
const idPattern = /^[A-Za-z0-9_.:/@-]+$/u;

interface StoredAbuseControlPolicy {
  version: 1;
  orgId: string;
  suspension: AbuseControlSuspension;
  entitlements: AbuseControlEntitlements;
  killSwitches: AbuseControlKillSwitches;
  updatedAt?: string;
  updatedBy?: string;
}

export interface AbuseControlEnforcementInput {
  action: AbuseControlAction;
  agentId?: string;
  connectorId?: string;
  providerId?: string;
  toolId?: string;
  workerClass?: string;
  workspaceId?: string;
}

export class AbuseControlService {
  constructor(private readonly repository: RomeoRepository) {}

  report(subject: AuthSubject): Promise<AbuseControlPolicyReport> {
    assertScope(subject, "admin:read");
    return readAbuseControlPolicy(this.repository, subject.orgId);
  }

  async update(input: {
    subject: AuthSubject;
    policy: UpdateAbuseControlPolicyRequest;
  }): Promise<AbuseControlPolicyReport> {
    return this.updateForOrg({
      subject: input.subject,
      orgId: input.subject.orgId,
      policy: input.policy,
    });
  }

  async updateForOrg(input: {
    subject: AuthSubject;
    orgId: string;
    policy: UpdateAbuseControlPolicyRequest;
  }): Promise<AbuseControlPolicyReport> {
    assertScope(input.subject, "admin:write");
    if (
      input.orgId !== input.subject.orgId &&
      input.subject.adminRole !== "global_admin"
    ) {
      throw new ApiError(
        "global_admin_required",
        "Global admin role is required for cross-organization abuse-control updates.",
        403,
      );
    }
    if (isEmptyPatch(input.policy)) {
      throw new ApiError(
        "abuse_control_empty_update",
        "Abuse control update must include at least one field.",
        400,
      );
    }

    return this.repository.transaction(async (repository) => {
      const organization = await repository.getOrganization(input.orgId);
      if (organization === undefined) {
        throw new ApiError(
          "organization_not_found",
          "Organization was not found.",
          404,
        );
      }
      const existing = await readStoredPolicy(repository, input.orgId);
      const previous = await toReport(repository, input.orgId, existing);
      const now = new Date().toISOString();
      const updated = applyPatch(
        existing ?? defaultStoredPolicy(input.orgId),
        input.policy,
        now,
        input.subject.id,
      );
      await repository.upsertSystemSetting({
        key: settingKey(input.orgId),
        value: serializeStoredPolicy(updated),
        updatedAt: now,
      });
      const report = await toReport(repository, input.orgId, updated);
      await writeAuditLog(repository, {
        subject: input.subject,
        action: "admin.abuse_controls.update",
        resourceType: "abuse_control_policy",
        resourceId: input.orgId,
        metadata: policyAuditMetadata(previous, report),
      });
      return report;
    });
  }
}

export async function readAbuseControlPolicy(
  repository: RomeoRepository,
  orgId: string,
): Promise<AbuseControlPolicyReport> {
  return toReport(repository, orgId, await readStoredPolicy(repository, orgId));
}

export async function assertAbuseControlsAllow(
  repository: RomeoRepository,
  subject: AuthSubject,
  input: AbuseControlEnforcementInput,
): Promise<void> {
  const report = await readAbuseControlPolicy(repository, subject.orgId);
  const reasons = enforcementReasons(report, input);
  if (reasons.length === 0) return;

  await writeAuditLog(repository, {
    subject,
    action: "abuse_control.enforcement_blocked",
    resourceType: "abuse_control_policy",
    resourceId: subject.orgId,
    outcome: "failure",
    metadata: {
      action: input.action,
      reasonCodes: reasons,
      ...(input.agentId === undefined ? {} : { agentId: input.agentId }),
      ...(input.connectorId === undefined
        ? {}
        : { connectorId: input.connectorId }),
      ...(input.providerId === undefined
        ? {}
        : { providerId: input.providerId }),
      ...(input.toolId === undefined ? {} : { toolId: input.toolId }),
      ...(input.workerClass === undefined
        ? {}
        : { workerClass: input.workerClass }),
      ...(input.workspaceId === undefined
        ? {}
        : { workspaceId: input.workspaceId }),
    },
  });
  throw new ApiError(
    "abuse_control_blocked",
    "Cost-incurring work is blocked by organization abuse controls.",
    403,
    {
      action: input.action,
      reasonCodes: reasons,
    },
  );
}

function enforcementReasons(
  report: AbuseControlPolicyReport,
  input: AbuseControlEnforcementInput,
): AbuseControlBlockReason[] {
  const reasons = [...report.enforcement.defaultBlockReasons];
  if (
    input.providerId !== undefined &&
    report.killSwitches.providerIds.includes(input.providerId)
  ) {
    reasons.push("provider_kill_switch");
  }
  if (
    input.connectorId !== undefined &&
    report.killSwitches.connectorIds.includes(input.connectorId)
  ) {
    reasons.push("connector_kill_switch");
  }
  if (
    input.toolId !== undefined &&
    report.killSwitches.toolIds.includes(input.toolId)
  ) {
    reasons.push("tool_kill_switch");
  }
  if (
    input.workerClass !== undefined &&
    report.killSwitches.workerClasses.includes(input.workerClass)
  ) {
    reasons.push("worker_class_kill_switch");
  }
  return uniqueReasons(reasons);
}

async function toReport(
  repository: RomeoRepository,
  orgId: string,
  stored: StoredAbuseControlPolicy | undefined,
): Promise<AbuseControlPolicyReport> {
  const policy = stored ?? defaultStoredPolicy(orgId);
  const billingPlan = await repository.getBillingPlan(orgId);
  const defaultBlockReasons = defaultBlockReasonsFor(policy, billingPlan);
  return {
    orgId,
    source: stored === undefined ? "default" : "org",
    generatedAt: new Date().toISOString(),
    suspension: { ...policy.suspension },
    entitlements: {
      ...policy.entitlements,
      allowedBillingStatuses: [...policy.entitlements.allowedBillingStatuses],
    },
    killSwitches: cloneKillSwitches(policy.killSwitches),
    enforcement: {
      billingPlanConfigured: billingPlan !== undefined,
      ...(billingPlan?.code === undefined
        ? {}
        : { billingPlanCode: billingPlan.code }),
      ...(billingPlan?.status === undefined
        ? {}
        : { billingStatus: billingPlan.status }),
      costWorkBlocked: defaultBlockReasons.length > 0,
      defaultBlockReasons,
      activeKillSwitchCount:
        policy.killSwitches.connectorIds.length +
        policy.killSwitches.providerIds.length +
        policy.killSwitches.toolIds.length +
        policy.killSwitches.workerClasses.length,
    },
    ...(policy.updatedAt === undefined ? {} : { updatedAt: policy.updatedAt }),
    ...(policy.updatedBy === undefined ? {} : { updatedBy: policy.updatedBy }),
  };
}

function defaultBlockReasonsFor(
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

async function readStoredPolicy(
  repository: RomeoRepository,
  orgId: string,
): Promise<StoredAbuseControlPolicy | undefined> {
  const setting = await repository.getSystemSetting(settingKey(orgId));
  if (setting === undefined) return undefined;
  return parseStoredPolicy(setting.value, orgId);
}

function parseStoredPolicy(
  value: Record<string, unknown>,
  orgId: string,
): StoredAbuseControlPolicy {
  if (value.version !== 1 || value.orgId !== orgId)
    return defaultStoredPolicy(orgId);
  return {
    version: 1,
    orgId,
    suspension: normalizeSuspension(value.suspension),
    entitlements: normalizeEntitlements(value.entitlements),
    killSwitches: normalizeKillSwitches(value.killSwitches),
    ...(typeof value.updatedAt === "string"
      ? { updatedAt: value.updatedAt }
      : {}),
    ...(typeof value.updatedBy === "string"
      ? { updatedBy: value.updatedBy }
      : {}),
  };
}

function defaultStoredPolicy(orgId: string): StoredAbuseControlPolicy {
  return {
    version: 1,
    orgId,
    suspension: { suspended: false },
    entitlements: {
      enforceBillingStatus: false,
      denyWhenBillingPlanMissing: false,
      allowedBillingStatuses: ["active", "trialing"],
    },
    killSwitches: {
      connectorIds: [],
      providerIds: [],
      toolIds: [],
      workerClasses: [],
    },
  };
}

function applyPatch(
  existing: StoredAbuseControlPolicy,
  patch: UpdateAbuseControlPolicyRequest,
  updatedAt: string,
  updatedBy: string,
): StoredAbuseControlPolicy {
  const next: StoredAbuseControlPolicy = {
    ...existing,
    suspension: { ...existing.suspension },
    entitlements: {
      ...existing.entitlements,
      allowedBillingStatuses: [...existing.entitlements.allowedBillingStatuses],
    },
    killSwitches: cloneKillSwitches(existing.killSwitches),
    updatedAt,
    updatedBy,
  };

  if (patch.suspension !== undefined) {
    const suspended = patch.suspension.suspended ?? next.suspension.suspended;
    const previousSuspended = next.suspension.suspended;
    next.suspension = {
      suspended,
      ...(patch.suspension.reasonCode === null ||
      patch.suspension.reasonCode === undefined
        ? {}
        : { reasonCode: normalizeReasonCode(patch.suspension.reasonCode) }),
      ...(suspended && !previousSuspended
        ? { suspendedAt: updatedAt, suspendedBy: updatedBy }
        : {}),
      ...(suspended &&
      previousSuspended &&
      next.suspension.suspendedAt !== undefined
        ? { suspendedAt: next.suspension.suspendedAt }
        : {}),
      ...(suspended &&
      previousSuspended &&
      next.suspension.suspendedBy !== undefined
        ? { suspendedBy: next.suspension.suspendedBy }
        : {}),
    };
    if (!suspended) next.suspension = { suspended: false };
    if (
      suspended &&
      patch.suspension.reasonCode === undefined &&
      existing.suspension.reasonCode !== undefined
    ) {
      next.suspension.reasonCode = existing.suspension.reasonCode;
    }
  }

  if (patch.entitlements !== undefined) {
    next.entitlements = {
      enforceBillingStatus:
        patch.entitlements.enforceBillingStatus ??
        next.entitlements.enforceBillingStatus,
      denyWhenBillingPlanMissing:
        patch.entitlements.denyWhenBillingPlanMissing ??
        next.entitlements.denyWhenBillingPlanMissing,
      allowedBillingStatuses:
        patch.entitlements.allowedBillingStatuses === undefined
          ? next.entitlements.allowedBillingStatuses
          : uniqueBillingStatuses(patch.entitlements.allowedBillingStatuses),
    };
  }

  if (patch.killSwitches !== undefined) {
    next.killSwitches = {
      connectorIds:
        patch.killSwitches.connectorIds === undefined
          ? next.killSwitches.connectorIds
          : normalizeIdList(patch.killSwitches.connectorIds, "connectorIds"),
      providerIds:
        patch.killSwitches.providerIds === undefined
          ? next.killSwitches.providerIds
          : normalizeIdList(patch.killSwitches.providerIds, "providerIds"),
      toolIds:
        patch.killSwitches.toolIds === undefined
          ? next.killSwitches.toolIds
          : normalizeIdList(patch.killSwitches.toolIds, "toolIds"),
      workerClasses:
        patch.killSwitches.workerClasses === undefined
          ? next.killSwitches.workerClasses
          : normalizeIdList(patch.killSwitches.workerClasses, "workerClasses"),
    };
  }

  return next;
}

function serializeStoredPolicy(
  policy: StoredAbuseControlPolicy,
): Record<string, unknown> {
  return {
    version: 1,
    orgId: policy.orgId,
    suspension: policy.suspension,
    entitlements: policy.entitlements,
    killSwitches: policy.killSwitches,
    ...(policy.updatedAt === undefined ? {} : { updatedAt: policy.updatedAt }),
    ...(policy.updatedBy === undefined ? {} : { updatedBy: policy.updatedBy }),
  };
}

function normalizeSuspension(value: unknown): AbuseControlSuspension {
  if (!isRecord(value)) return { suspended: false };
  const suspended = value.suspended === true;
  if (!suspended) return { suspended: false };
  return {
    suspended: true,
    ...(typeof value.reasonCode === "string" && isSafeValue(value.reasonCode)
      ? { reasonCode: value.reasonCode }
      : {}),
    ...(typeof value.suspendedAt === "string"
      ? { suspendedAt: value.suspendedAt }
      : {}),
    ...(typeof value.suspendedBy === "string"
      ? { suspendedBy: value.suspendedBy }
      : {}),
  };
}

function normalizeEntitlements(value: unknown): AbuseControlEntitlements {
  const defaults = defaultStoredPolicy("org").entitlements;
  if (!isRecord(value)) return defaults;
  return {
    enforceBillingStatus:
      typeof value.enforceBillingStatus === "boolean"
        ? value.enforceBillingStatus
        : defaults.enforceBillingStatus,
    denyWhenBillingPlanMissing:
      typeof value.denyWhenBillingPlanMissing === "boolean"
        ? value.denyWhenBillingPlanMissing
        : defaults.denyWhenBillingPlanMissing,
    allowedBillingStatuses: uniqueBillingStatuses(
      Array.isArray(value.allowedBillingStatuses)
        ? value.allowedBillingStatuses
        : defaults.allowedBillingStatuses,
    ),
  };
}

function normalizeKillSwitches(value: unknown): AbuseControlKillSwitches {
  if (!isRecord(value))
    return cloneKillSwitches(defaultStoredPolicy("org").killSwitches);
  return {
    connectorIds: normalizeIdList(value.connectorIds, "connectorIds"),
    providerIds: normalizeIdList(value.providerIds, "providerIds"),
    toolIds: normalizeIdList(value.toolIds, "toolIds"),
    workerClasses: normalizeIdList(value.workerClasses, "workerClasses"),
  };
}

function normalizeIdList(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new ApiError(
      "invalid_abuse_control_policy",
      `Abuse control ${field} must be an array.`,
      400,
    );
  }
  const ids = value.map((item) => {
    if (typeof item !== "string" || !isSafeValue(item)) {
      throw new ApiError(
        "invalid_abuse_control_policy",
        `Abuse control ${field} contains an invalid identifier.`,
        400,
      );
    }
    return item.trim();
  });
  return [...new Set(ids)].sort();
}

function normalizeReasonCode(value: string): string {
  if (!isSafeValue(value)) {
    throw new ApiError(
      "invalid_abuse_control_policy",
      "Suspension reason code is invalid.",
      400,
    );
  }
  return value.trim();
}

function uniqueBillingStatuses(values: unknown[]): BillingPlan["status"][] {
  const statuses = values.filter(
    (value): value is BillingPlan["status"] =>
      value === "active" ||
      value === "canceled" ||
      value === "past_due" ||
      value === "trialing",
  );
  const unique = [...new Set(statuses)].sort();
  return unique.length === 0 ? ["active", "trialing"] : unique;
}

function isSafeValue(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 200 && idPattern.test(trimmed);
}

function isEmptyPatch(policy: UpdateAbuseControlPolicyRequest): boolean {
  return (
    policy.suspension === undefined &&
    policy.entitlements === undefined &&
    policy.killSwitches === undefined
  );
}

function cloneKillSwitches(
  killSwitches: AbuseControlKillSwitches,
): AbuseControlKillSwitches {
  return {
    connectorIds: [...killSwitches.connectorIds],
    providerIds: [...killSwitches.providerIds],
    toolIds: [...killSwitches.toolIds],
    workerClasses: [...killSwitches.workerClasses],
  };
}

function uniqueReasons(
  reasons: AbuseControlBlockReason[],
): AbuseControlBlockReason[] {
  return [...new Set(reasons)];
}

function policyAuditMetadata(
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

function settingKey(orgId: string): string {
  return `${settingKeyPrefix}${orgId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

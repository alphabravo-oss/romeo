import type { CapabilityDefinition } from "./capability-definition-registry";
import type { CapabilityAssignmentState } from "./capability-definition-registry";

export const HIGH_RISK_PUBLICATION_CLASSES = [
  "mandatory_policy_weakening",
  "external_egress",
  "compute",
  "key",
  "retention",
  "export",
] as const;
export type HighRiskPublicationClass =
  (typeof HIGH_RISK_PUBLICATION_CLASSES)[number];

export type PolicyBundleState =
  | "draft"
  | "pending_approval"
  | "approved"
  | "published"
  | "rejected"
  | "rolled_back";

export interface PolicyBundleAssignmentPayload {
  scopeType: "organization" | "workspace" | "agent" | "group" | "user";
  scopeId: string;
  configuration: unknown;
  reason: string;
  expectedVersion?: number;
  expiresAt?: string | null;
  workspaceId?: string;
}

export interface PolicyBundleChange {
  capabilityId: string;
  currentState: CapabilityAssignmentState | "unset";
  nextState: CapabilityAssignmentState;
  publicationClass?: HighRiskPublicationClass;
  assignment?: PolicyBundleAssignmentPayload;
}

export interface PolicyBundle {
  id: string;
  orgId: string;
  state: PolicyBundleState;
  proposerId: string;
  approverId?: string;
  reason: string;
  changes: PolicyBundleChange[];
  createdAt: string;
  updatedAt: string;
}

export type PolicyBundleDecision =
  | { outcome: "publish" }
  | { outcome: "approval_required"; classes: HighRiskPublicationClass[] }
  | {
      outcome: "rejected";
      code:
        | "policy_bundle_self_approval_forbidden"
        | "policy_bundle_not_pending"
        | "policy_bundle_not_approved";
    };

export function publicationClassForCapability(
  definition: Pick<CapabilityDefinition, "id" | "risk">,
  currentState: CapabilityAssignmentState | "unset",
  nextState: CapabilityAssignmentState,
  scopeType?: "organization" | "workspace" | "agent" | "group" | "user",
): HighRiskPublicationClass | undefined {
  if (definition.id === "secure_compute") return "compute";
  if (definition.id === "tenant_encryption") return "key";
  if (definition.id === "data_export") return "export";
  if (
    (definition.id === "realtime_voice" || definition.id === "web_retrieval") &&
    (scopeType === undefined ||
      scopeType === "organization" ||
      scopeType === "workspace") &&
    (nextState === "enabled" || nextState === "required")
  )
    return "external_egress";
  if (
    (definition.id === "content_firewall" ||
      definition.id === "knowledge_acl" ||
      definition.risk === "critical") &&
    isPolicyWeakening(currentState, nextState)
  )
    return "mandatory_policy_weakening";
  return undefined;
}

export function isPolicyWeakening(
  current: CapabilityAssignmentState | "unset",
  next: CapabilityAssignmentState,
): boolean {
  if (current === "required" && next !== "required") return true;
  if (current === "enabled" && next === "disabled") return true;
  return false;
}

export function evaluatePolicyBundlePublication(input: {
  changes: PolicyBundleChange[];
}): Extract<PolicyBundleDecision, { outcome: "publish" | "approval_required" }> {
  const classes = [
    ...new Set(
      input.changes.flatMap((change) =>
        change.publicationClass === undefined ? [] : [change.publicationClass],
      ),
    ),
  ];
  return classes.length === 0
    ? { outcome: "publish" }
    : { outcome: "approval_required", classes };
}

export function applyPolicyBundleApproval(input: {
  bundle: PolicyBundle;
  actorId: string;
  now: string;
}): PolicyBundle | PolicyBundleDecision {
  if (input.bundle.state !== "pending_approval")
    return { outcome: "rejected", code: "policy_bundle_not_pending" };
  if (input.actorId === input.bundle.proposerId)
    return {
      outcome: "rejected",
      code: "policy_bundle_self_approval_forbidden",
    };
  return {
    ...input.bundle,
    state: "approved",
    approverId: input.actorId,
    updatedAt: input.now,
  };
}

export function publishApprovedPolicyBundle(input: {
  bundle: PolicyBundle;
  now: string;
}): PolicyBundle | PolicyBundleDecision {
  if (input.bundle.state !== "approved" || input.bundle.approverId === undefined)
    return { outcome: "rejected", code: "policy_bundle_not_approved" };
  return { ...input.bundle, state: "published", updatedAt: input.now };
}

export function rollbackPolicyBundle(input: {
  bundle: PolicyBundle;
  now: string;
}): PolicyBundle {
  return { ...input.bundle, state: "rolled_back", updatedAt: input.now };
}

export interface PolicyApprovalRecord {
  id: string;
  orgId: string;
  runId: string;
  decisionId: string;
  actorId: string;
  state: "pending" | "approved" | "denied" | "expired";
  expiresAt: string;
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
}

export function requestPolicyApproval(input: {
  id: string;
  orgId: string;
  runId: string;
  decisionId: string;
  actorId: string;
  expiresAt: string;
  now: string;
  matchTextPresent: boolean;
}):
  | { outcome: "paused"; approval: PolicyApprovalRecord }
  | {
      outcome: "denied";
      code: "content_policy_approval_expired" | "content_policy_approval_required";
    } {
  if (input.matchTextPresent)
    return { outcome: "denied", code: "content_policy_approval_required" };
  if (Date.parse(input.expiresAt) <= Date.parse(input.now))
    return { outcome: "denied", code: "content_policy_approval_expired" };
  return {
    outcome: "paused",
    approval: {
      id: input.id,
      orgId: input.orgId,
      runId: input.runId,
      decisionId: input.decisionId,
      actorId: input.actorId,
      state: "pending",
      expiresAt: input.expiresAt,
      createdAt: input.now,
    },
  };
}

export function resolvePolicyApproval(input: {
  approval: PolicyApprovalRecord;
  actorId: string;
  now: string;
  decision: "approve" | "deny";
  runId: string;
}):
  | { outcome: "approved" | "denied"; approval: PolicyApprovalRecord }
  | {
      outcome: "denied";
      code: "content_policy_approval_expired" | "content_policy_approval_scope_mismatch";
    } {
  if (input.approval.runId !== input.runId)
    return { outcome: "denied", code: "content_policy_approval_scope_mismatch" };
  if (
    input.approval.state !== "pending" ||
    Date.parse(input.approval.expiresAt) <= Date.parse(input.now)
  )
    return { outcome: "denied", code: "content_policy_approval_expired" };
  const state = input.decision === "approve" ? "approved" : "denied";
  return {
    outcome: state,
    approval: {
      ...input.approval,
      state,
      resolvedAt: input.now,
      resolvedBy: input.actorId,
    },
  };
}

export function publicPolicyApproval(approval: PolicyApprovalRecord) {
  return {
    id: approval.id,
    runId: approval.runId,
    decisionId: approval.decisionId,
    state: approval.state,
    expiresAt: approval.expiresAt,
    createdAt: approval.createdAt,
    ...(approval.resolvedAt === undefined ? {} : { resolvedAt: approval.resolvedAt }),
  };
}

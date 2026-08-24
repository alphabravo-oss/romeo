export type ContentPolicyDecisionAction =
  | "allow"
  | "audit"
  | "redact"
  | "block";

export interface ContentPolicyDecisionRecord {
  id: string;
  orgId: string;
  policyVersionId: string;
  surface: string;
  action: ContentPolicyDecisionAction;
  detectors: Array<{
    action: "audit" | "block" | "redact";
    code: "api_token" | "credit_card" | "email_address" | "us_ssn";
    count: number;
  }>;
  decidedAt: string;
  runId?: string;
  executionJobId?: string;
}

export type PolicyApprovalState = "pending" | "approved" | "denied" | "expired";

export interface PolicyApprovalRecord {
  id: string;
  orgId: string;
  runId: string;
  decisionId: string;
  policyVersionId: string;
  executionJobId?: string;
  actorId: string;
  state: PolicyApprovalState;
  expiresAt: string;
  createdAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
}

export interface TransitionPolicyApprovalInput {
  approvalId: string;
  expectedState: "pending";
  nextState: Exclude<PolicyApprovalState, "pending">;
  orgId: string;
  resolvedAt: string;
  resolvedBy?: string;
}

export interface ContentPolicySeedData {
  contentPolicyDecisions: ContentPolicyDecisionRecord[];
  contentPolicyApprovals: PolicyApprovalRecord[];
}

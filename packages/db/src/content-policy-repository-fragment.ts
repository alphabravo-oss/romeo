import type { PgContentPolicyRepository } from "./content-policy-repository";

export type ContentPolicyRepositoryFragment = Pick<
  PgContentPolicyRepository,
  | "createContentPolicyApproval"
  | "createContentPolicyDecision"
  | "getContentPolicyApproval"
  | "getContentPolicyDecision"
  | "listContentPolicyApprovals"
  | "listContentPolicyDecisions"
  | "listPendingContentPolicyApprovalsDue"
  | "transitionContentPolicyApproval"
>;

import type { RomeoDatabase } from "./client";
import { PgContentPolicyRepository } from "./content-policy-repository";
import type { ContentPolicyRepositoryFragment } from "./content-policy-repository-fragment";

export function createContentPolicyRepositoryFragment(
  db: RomeoDatabase,
): ContentPolicyRepositoryFragment {
  const repository = new PgContentPolicyRepository(db);
  return {
    createContentPolicyApproval:
      repository.createContentPolicyApproval.bind(repository),
    createContentPolicyDecision:
      repository.createContentPolicyDecision.bind(repository),
    getContentPolicyApproval:
      repository.getContentPolicyApproval.bind(repository),
    getContentPolicyDecision:
      repository.getContentPolicyDecision.bind(repository),
    listContentPolicyApprovals:
      repository.listContentPolicyApprovals.bind(repository),
    listContentPolicyDecisions:
      repository.listContentPolicyDecisions.bind(repository),
    listPendingContentPolicyApprovalsDue:
      repository.listPendingContentPolicyApprovalsDue.bind(repository),
    transitionContentPolicyApproval:
      repository.transitionContentPolicyApproval.bind(repository),
  };
}

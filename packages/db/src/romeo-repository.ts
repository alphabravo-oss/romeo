import {
  ROMEO_REPOSITORY_METHOD_NAMES,
  type RomeoRepository,
} from "@romeo/core";

import type { RomeoDatabase } from "./client";
import {
  composeRepositoryFragments,
  createAccessRepositoryFragment,
  createCapabilityAssignmentRepositoryFragment,
  createCapabilityFlagRepositoryFragment,
  createIdempotencyRepositoryFragment,
  createInventoriedTablePageRepositoryFragment,
  createAgentEvalRepositoryFragment,
  createAuthCredentialRepositoryFragment,
  createChatRepositoryFragment,
  createChatTagRepositoryFragment,
  createCollaborationRepositoryFragment,
  createContentPolicyRepositoryFragment,
  createContentDeletionRepositoryFragment,
  createDataDeletionRepositoryFragment,
  createFileRepositoryFragment,
  createGovernanceBillingRepositoryFragment,
  createGovernanceExportRepositoryFragment,
  createKnowledgeEmbeddingRepositoryFragment,
  createKnowledgeRepositoryFragment,
  createNotificationRepositoryFragment,
  createOperationalRepositoryFragment,
  createCollaborationChannelRepositoryFragment,
  createProviderRepositoryFragment,
  createRunRepositoryFragment,
  createServerTableRepositoryFragment,
  createTenantIdentityRepositoryFragment,
  createToolConnectorRepositoryFragment,
  createVoiceRepositoryFragment,
  createWebhookRepositoryFragment,
} from "./repository-fragments";

export function createPostgresRomeoRepositoryFromDatabase(
  db: RomeoDatabase,
): RomeoRepository {
  const repository = {
    runtime: {
      driver: "postgres",
      durable: true,
      storageScope: "database",
      description: "Postgres repository composed from domain fragments.",
    },
    transaction: async <T>(
      work: (repository: RomeoRepository) => Promise<T>,
    ): Promise<T> =>
      db.transaction((tx) =>
        work(
          createPostgresRomeoRepositoryFromDatabase(
            tx as unknown as RomeoDatabase,
          ),
        ),
      ),
    ...composeRepositoryFragments(
      createTenantIdentityRepositoryFragment(db),
      createAuthCredentialRepositoryFragment(db),
      createProviderRepositoryFragment(db),
      createAgentEvalRepositoryFragment(db),
      createChatRepositoryFragment(db),
      createChatTagRepositoryFragment(db),
      createFileRepositoryFragment(db),
      createCollaborationChannelRepositoryFragment(db),
      createRunRepositoryFragment(db),
      createServerTableRepositoryFragment(db),
      createToolConnectorRepositoryFragment(db),
      createOperationalRepositoryFragment(db),
      createContentPolicyRepositoryFragment(db),
      createContentDeletionRepositoryFragment(db),
      createWebhookRepositoryFragment(db),
      createGovernanceBillingRepositoryFragment(db),
      createGovernanceExportRepositoryFragment(db),
      createNotificationRepositoryFragment(db),
      createCollaborationRepositoryFragment(db),
      createAccessRepositoryFragment(db),
      createCapabilityAssignmentRepositoryFragment(db),
      createCapabilityFlagRepositoryFragment(db),
      createIdempotencyRepositoryFragment(db),
      createInventoriedTablePageRepositoryFragment(db),
      createVoiceRepositoryFragment(db),
      createDataDeletionRepositoryFragment(db),
      createKnowledgeRepositoryFragment(db),
      createKnowledgeEmbeddingRepositoryFragment(db),
    ),
  } satisfies RomeoRepository;

  assertRepositoryMethods(repository);
  return repository;
}

export function assertRepositoryMethods(repository: RomeoRepository): void {
  for (const method of ROMEO_REPOSITORY_METHOD_NAMES) {
    if (typeof repository[method] !== "function") {
      throw new Error(`Postgres repository is missing method: ${method}`);
    }
  }
}

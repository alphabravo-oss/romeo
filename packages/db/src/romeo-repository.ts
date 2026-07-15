import {
  ROMEO_REPOSITORY_METHOD_NAMES,
  type RomeoRepository,
} from "@romeo/core";
import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";

import type { RomeoDatabase } from "./client";
import {
  composeRepositoryFragments,
  createAccessRepositoryFragment,
  createAgentEvalRepositoryFragment,
  createAuthCredentialRepositoryFragment,
  createChatRepositoryFragment,
  createChatTagRepositoryFragment,
  createCollaborationRepositoryFragment,
  createDataConnectorRepositoryFragment,
  createDataDeletionRepositoryFragment,
  createDelegatedOAuthRepositoryFragment,
  createFileRepositoryFragment,
  createGovernanceBillingRepositoryFragment,
  createKnowledgeEmbeddingRepositoryFragment,
  createKnowledgeRepositoryFragment,
  createNotificationRepositoryFragment,
  createOperationalRepositoryFragment,
  createCollaborationChannelRepositoryFragment,
  createProviderRepositoryFragment,
  createRunRepositoryFragment,
  createTenantIdentityRepositoryFragment,
  createToolConnectorRepositoryFragment,
  createVoiceRepositoryFragment,
  createWebhookRepositoryFragment,
  createWorkflowRepositoryFragment,
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
    withDelegatedOAuthConnectionRefreshLock: async <T>(
      connectionId: string,
      work: (repository: RomeoRepository) => Promise<T>,
    ): Promise<T> =>
      db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(${advisoryLockKey(connectionId)}::bigint)`,
        );
        return work(
          createPostgresRomeoRepositoryFromDatabase(
            tx as unknown as RomeoDatabase,
          ),
        );
      }),
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
      createToolConnectorRepositoryFragment(db),
      createDataConnectorRepositoryFragment(db),
      createDelegatedOAuthRepositoryFragment(db),
      createOperationalRepositoryFragment(db),
      createWebhookRepositoryFragment(db),
      createWorkflowRepositoryFragment(db),
      createGovernanceBillingRepositoryFragment(db),
      createNotificationRepositoryFragment(db),
      createCollaborationRepositoryFragment(db),
      createAccessRepositoryFragment(db),
      createVoiceRepositoryFragment(db),
      createDataDeletionRepositoryFragment(db),
      createKnowledgeRepositoryFragment(db),
      createKnowledgeEmbeddingRepositoryFragment(db),
    ),
  } satisfies RomeoRepository;

  assertRepositoryMethods(repository);
  return repository;
}

function advisoryLockKey(value: string): bigint {
  return createHash("sha256").update(value).digest().readBigInt64BE(0);
}

export function assertRepositoryMethods(repository: RomeoRepository): void {
  for (const method of ROMEO_REPOSITORY_METHOD_NAMES) {
    if (typeof repository[method] !== "function") {
      throw new Error(`Postgres repository is missing method: ${method}`);
    }
  }
}

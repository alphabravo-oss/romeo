import type { RomeoRepository } from "@romeo/core";

import type { RomeoDatabase } from "./client";
import { PgContentDeletionRepository } from "./content-deletion-repository";

export type ContentDeletionRepositoryFragment = Pick<
  RomeoRepository,
  | "claimContentDeletionOperation"
  | "createContentDeletionOperation"
  | "getActiveContentDeletionOperation"
  | "getContentDeletionOperation"
  | "updateContentDeletionOperationWithLease"
  | "renewContentDeletionOperationLease"
>;

export function createContentDeletionRepositoryFragment(
  db: RomeoDatabase,
): ContentDeletionRepositoryFragment {
  const repository = new PgContentDeletionRepository(db);
  return {
    claimContentDeletionOperation:
      repository.claimContentDeletionOperation.bind(repository),
    createContentDeletionOperation:
      repository.createContentDeletionOperation.bind(repository),
    getActiveContentDeletionOperation:
      repository.getActiveContentDeletionOperation.bind(repository),
    getContentDeletionOperation:
      repository.getContentDeletionOperation.bind(repository),
    updateContentDeletionOperationWithLease:
      repository.updateContentDeletionOperationWithLease.bind(repository),
    renewContentDeletionOperationLease:
      repository.renewContentDeletionOperationLease.bind(repository),
  };
}

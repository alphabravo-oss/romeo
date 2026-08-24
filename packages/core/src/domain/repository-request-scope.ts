import type { RomeoRepository } from "./repository";

export interface RepositoryRequestScope {
  /**
   * Supplies a retainable scope-bound proxy. Implementations must not hold a
   * database transaction for the lifetime of `work`; repository methods open
   * short units and `repository.transaction` is the explicit pinning boundary.
   */
  runAsSystem<T>(work: (repository: RomeoRepository) => Promise<T>): Promise<T>;
  runAsTenant<T>(
    orgId: string,
    work: (repository: RomeoRepository) => Promise<T>,
  ): Promise<T>;
}

let mutationSessionVersion = 0;

/** Captured by every managed mutation before it may update client state. */
export function currentMutationSessionVersion(): number {
  return mutationSessionVersion;
}

/** Logout/session replacement makes every in-flight reconciliation stale. */
export function advanceMutationSessionBoundary(): void {
  mutationSessionVersion += 1;
}

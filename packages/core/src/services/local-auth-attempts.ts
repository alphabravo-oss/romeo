import type { LocalPasswordCredential } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";

/** Verification attempts one MFA challenge serves before it is unusable. */
export const maxLocalMfaChallengeAttempts = 5;
/**
 * Consecutive MFA failures (across challenges) that lock the password
 * credential. Tracked separately from password failures so re-entering the
 * password to mint a fresh challenge never resets the MFA guessing budget.
 */
export const maxConsecutiveLocalMfaFailures = 10;
export const maxFailedLocalPasswordAttempts = 10;
export const localAuthLockoutMs = 15 * 60 * 1000;

export async function recordFailedLocalPasswordAttempt(
  repository: RomeoRepository,
  credential: LocalPasswordCredential,
): Promise<{ locked: boolean }> {
  const now = new Date();
  const update = await repository.recordFailedLocalPasswordAttempt({
    credentialId: credential.id,
    attemptedAt: now.toISOString(),
    lockedUntil: new Date(now.getTime() + localAuthLockoutMs).toISOString(),
    maxFailedAttempts: maxFailedLocalPasswordAttempts,
  });
  return { locked: update?.lockedUntil !== undefined };
}

export async function recordFailedLocalMfaAttempt(
  repository: RomeoRepository,
  credential: LocalPasswordCredential,
): Promise<{ locked: boolean }> {
  const now = new Date();
  const update = await repository.recordFailedLocalMfaAttempt({
    credentialId: credential.id,
    attemptedAt: now.toISOString(),
    lockedUntil: new Date(now.getTime() + localAuthLockoutMs).toISOString(),
    maxFailedAttempts: maxConsecutiveLocalMfaFailures,
  });
  return {
    locked:
      update?.lockedUntil !== undefined &&
      Date.parse(update.lockedUntil) > now.getTime(),
  };
}

export async function resetFailedLocalMfaAttempts(
  repository: RomeoRepository,
  credential: LocalPasswordCredential,
): Promise<void> {
  await repository.resetFailedLocalMfaAttempts({
    credentialId: credential.id,
    updatedAt: new Date().toISOString(),
  });
}

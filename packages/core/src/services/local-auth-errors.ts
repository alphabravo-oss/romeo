import type { LocalPasswordCredential } from "../domain/entities";
import { ApiError } from "../errors";

export function invalidLocalLogin(): ApiError {
  return new ApiError(
    "local_login_invalid",
    "Email, password, or MFA code is invalid.",
    401,
  );
}

export function invalidCurrentPassword(): ApiError {
  return new ApiError(
    "current_password_invalid",
    "Current password is invalid.",
    401,
  );
}

export function isCredentialLocked(
  credential: LocalPasswordCredential,
): boolean {
  return (
    credential.lockedUntil !== undefined &&
    new Date(credential.lockedUntil).getTime() > Date.now()
  );
}

export function unlockedPasswordCredential(
  credential: LocalPasswordCredential,
): LocalPasswordCredential {
  const next: LocalPasswordCredential = {
    ...credential,
    failedAttemptCount: 0,
    updatedAt: new Date().toISOString(),
  };
  delete next.lockedUntil;
  return next;
}

import type { AuthSubject } from "@romeo/auth";

import type { LocalMfaFactor, User } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";

export async function requireSubjectUser(
  repository: RomeoRepository,
  subject: AuthSubject,
): Promise<User> {
  const user = await repository.getCurrentUser(subject.id);
  if (
    user === undefined ||
    user.orgId !== subject.orgId ||
    user.disabledAt !== undefined
  )
    throw notFound("User");
  return user;
}

export async function requireOwnedMfaFactor(
  repository: RomeoRepository,
  subject: AuthSubject,
  factorId: string,
): Promise<LocalMfaFactor> {
  if (subject.type !== "user")
    throw new ApiError(
      "local_auth_user_required",
      "Local MFA is only available for users.",
      403,
    );
  const factor = await repository.getLocalMfaFactor(factorId);
  if (
    factor === undefined ||
    factor.orgId !== subject.orgId ||
    (factor.userId !== subject.id && subject.isAdmin !== true)
  )
    throw notFound("MFA factor");
  return factor;
}

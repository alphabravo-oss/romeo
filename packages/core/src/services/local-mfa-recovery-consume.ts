import type { LocalMfaFactor, User } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import type { LocalAuthAudit } from "./local-auth-audit";
import {
  consumeLocalMfaRecoveryCode,
  localMfaRecoveryCodeRemainingCount,
  parseLocalMfaRecoveryCodeEnvelope,
  serializeLocalMfaRecoveryCodeEnvelope,
} from "./local-mfa-recovery-codes";
import type { LocalMfaSecretVault } from "./local-mfa-secret-vault";

export function localMfaSecretContext(factor: LocalMfaFactor) {
  return {
    factorId: factor.id,
    factorType: factor.type,
    orgId: factor.orgId,
    userId: factor.userId,
  };
}

export function parseRecoveryCodeFactorEnvelope(
  vault: LocalMfaSecretVault,
  factor: LocalMfaFactor,
): ReturnType<typeof parseLocalMfaRecoveryCodeEnvelope> | undefined {
  try {
    return parseLocalMfaRecoveryCodeEnvelope(
      vault.decrypt(factor.secretEncrypted, localMfaSecretContext(factor)),
    );
  } catch {
    return undefined;
  }
}

/** Consumes one recovery code with a compare-and-set on the factor secret. */
export async function consumeRecoveryCodeForUser(input: {
  audit: LocalAuthAudit;
  recoveryCode: string;
  repository: RomeoRepository;
  user: User;
  vault: LocalMfaSecretVault;
}): Promise<boolean> {
  const { audit, user, vault } = input;
  const factors = (
    await input.repository.listLocalMfaFactors(user.orgId, user.id)
  ).filter(
    (factor) => factor.type === "recovery_codes" && factor.status === "active",
  );
  const now = new Date().toISOString();
  for (const factor of factors) {
    const envelope = parseRecoveryCodeFactorEnvelope(vault, factor);
    if (envelope === undefined) continue;
    const result = consumeLocalMfaRecoveryCode(
      envelope,
      input.recoveryCode,
      now,
    );
    if (!result.consumed) continue;
    const remainingCount = localMfaRecoveryCodeRemainingCount(result.envelope);
    const didConsume = await input.repository.transaction(
      async (repository) => {
        const consumedFactor = await repository.consumeLocalMfaFactor({
          expectedSecretEncrypted: factor.secretEncrypted,
          factor: {
            ...factor,
            secretEncrypted: vault.encrypt(
              serializeLocalMfaRecoveryCodeEnvelope(result.envelope),
              localMfaSecretContext(factor),
            ),
            status: remainingCount === 0 ? "disabled" : "active",
            ...(remainingCount === 0 ? { disabledAt: now } : {}),
            lastUsedAt: now,
            updatedAt: now,
          },
        });
        if (consumedFactor === undefined) return false;
        await audit.write(
          {
            orgId: user.orgId,
            actorId: user.id,
            action: "local_auth.mfa.recovery_code.consume",
            resourceType: "local_mfa_factor",
            resourceId: factor.id,
            metadata: { type: "recovery_codes", remainingCount },
          },
          repository,
        );
        return true;
      },
    );
    if (didConsume) return true;
  }
  return false;
}

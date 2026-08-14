import { assertScope, type AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";

import type { LocalMfaFactor, User } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { createId } from "../ids";
import { LocalAuthAudit } from "./local-auth-audit";
import { requireOwnedMfaFactor, requireSubjectUser } from "./local-mfa-access";
import { invalidLocalLogin } from "./local-auth-errors";
import type {
  LocalMfaFactorSummary,
  LocalMfaMethod,
  LocalMfaRecoveryCodes,
  TotpEnrollment,
} from "./local-auth-types";
import { createTotpEnrollmentSecret, verifyTotpCode } from "./local-mfa";
import { normalizeFactorName, toFactorSummary } from "./local-mfa-summary";
import {
  consumeLocalMfaRecoveryCode,
  generateLocalMfaRecoveryCodes,
  localMfaRecoveryCodeRemainingCount,
  parseLocalMfaRecoveryCodeEnvelope,
  serializeLocalMfaRecoveryCodeEnvelope,
} from "./local-mfa-recovery-codes";
import { summarizeLocalMfaPosture } from "./local-mfa-posture";
import { LocalMfaSecretVault } from "./local-mfa-secret-vault";

export class LocalMfaService {
  private readonly audit: LocalAuthAudit;

  constructor(
    private readonly repository: RomeoRepository,
    private readonly env: RomeoEnv,
  ) {
    this.audit = new LocalAuthAudit(repository, env);
  }

  async factorSummaries(
    orgId: string,
    userId: string,
  ): Promise<LocalMfaFactorSummary[]> {
    const factors = await this.repository.listLocalMfaFactors(orgId, userId);
    return factors.map((factor) =>
      toFactorSummary(factor, this.recoveryCodeRemainingCount(factor)),
    );
  }

  async startTotpEnrollment(input: {
    subject: AuthSubject;
    name?: string;
  }): Promise<TotpEnrollment> {
    assertScope(input.subject, "me:read");
    if (input.subject.type !== "user")
      throw new ApiError(
        "local_auth_user_required",
        "Local MFA is only available for users.",
        403,
      );
    const user = await requireSubjectUser(this.repository, input.subject);
    const enrollment = createTotpEnrollmentSecret({ email: user.email });
    const now = new Date().toISOString();
    const factor = await this.repository.transaction(async (repository) => {
      const factorId = createId("mfa_factor");
      const factor = await repository.createLocalMfaFactor({
        id: factorId,
        orgId: user.orgId,
        userId: user.id,
        type: "totp",
        name: normalizeFactorName(input.name),
        status: "pending",
        secretEncrypted: this.mfaVault().encrypt(enrollment.secret, {
          factorId,
          factorType: "totp",
          orgId: user.orgId,
          userId: user.id,
        }),
        createdAt: now,
        updatedAt: now,
      });
      await this.audit.write(
        {
          orgId: user.orgId,
          actorId: user.id,
          action: "local_auth.mfa.enroll",
          resourceType: "local_mfa_factor",
          resourceId: factor.id,
          metadata: { type: "totp" },
        },
        repository,
      );
      return factor;
    });
    return {
      factor: toFactorSummary(factor),
      secret: enrollment.secret,
      otpauthUri: enrollment.otpauthUri,
    };
  }

  async confirmTotpEnrollment(input: {
    subject: AuthSubject;
    factorId: string;
    code: string;
  }): Promise<LocalMfaFactorSummary> {
    assertScope(input.subject, "me:read");
    const factor = await requireOwnedMfaFactor(
      this.repository,
      input.subject,
      input.factorId,
    );
    if (factor.status !== "pending") {
      throw new ApiError(
        "local_mfa_factor_not_pending",
        "MFA factor is not pending confirmation.",
        409,
      );
    }
    const secret = this.mfaVault().decrypt(
      factor.secretEncrypted,
      localMfaSecretContext(factor),
    );
    if (!(await verifyTotpCode({ secret, code: input.code }))) {
      throw new ApiError("local_mfa_code_invalid", "MFA code is invalid.", 401);
    }
    const now = new Date().toISOString();
    const confirmed = await this.repository.transaction(async (repository) => {
      const confirmed = await repository.updateLocalMfaFactor({
        ...factor,
        status: "active",
        confirmedAt: now,
        lastUsedAt: now,
        updatedAt: now,
      });
      await this.audit.write(
        {
          orgId: input.subject.orgId,
          actorId: input.subject.id,
          action: "local_auth.mfa.confirm",
          resourceType: "local_mfa_factor",
          resourceId: confirmed.id,
          metadata: { type: "totp" },
        },
        repository,
      );
      return confirmed;
    });
    return toFactorSummary(confirmed);
  }

  async generateRecoveryCodes(input: {
    subject: AuthSubject;
    totpCode: string;
  }): Promise<LocalMfaRecoveryCodes> {
    assertScope(input.subject, "me:read");
    if (input.subject.type !== "user")
      throw new ApiError(
        "local_auth_user_required",
        "Local MFA is only available for users.",
        403,
      );
    const user = await requireSubjectUser(this.repository, input.subject);
    const activeTotpFactors = await this.activeTotpFactors(user.orgId, user.id);
    if (activeTotpFactors.length === 0) {
      throw new ApiError(
        "local_mfa_totp_required",
        "An active TOTP factor is required to generate recovery codes.",
        409,
      );
    }
    await this.assertValidTotpCode(activeTotpFactors, input.totpCode);
    const now = new Date().toISOString();
    const generated = generateLocalMfaRecoveryCodes(now);
    const factor = await this.repository.transaction(async (repository) => {
      await this.disableActiveRecoveryCodeFactors(
        repository,
        user.orgId,
        user.id,
        now,
      );
      const factorId = createId("mfa_recovery_codes");
      const factor = await repository.createLocalMfaFactor({
        id: factorId,
        orgId: user.orgId,
        userId: user.id,
        type: "recovery_codes",
        name: "Recovery codes",
        status: "active",
        secretEncrypted: this.mfaVault().encrypt(
          serializeLocalMfaRecoveryCodeEnvelope(generated.envelope),
          {
            factorId,
            factorType: "recovery_codes",
            orgId: user.orgId,
            userId: user.id,
          },
        ),
        confirmedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      await this.audit.write(
        {
          orgId: user.orgId,
          actorId: user.id,
          action: "local_auth.mfa.recovery_codes.generate",
          resourceType: "local_mfa_factor",
          resourceId: factor.id,
          metadata: {
            type: "recovery_codes",
            codeCount: generated.codes.length,
          },
        },
        repository,
      );
      return factor;
    });
    return {
      factor: toFactorSummary(factor, generated.codes.length),
      codes: generated.codes,
      recoveryCodeRemainingCount: generated.codes.length,
    };
  }

  async disableTotpFactor(input: {
    subject: AuthSubject;
    factorId: string;
    code?: string;
  }): Promise<LocalMfaFactorSummary> {
    assertScope(input.subject, "me:read");
    const factor = await requireOwnedMfaFactor(
      this.repository,
      input.subject,
      input.factorId,
    );
    if (factor.status === "disabled") return toFactorSummary(factor);
    if (
      input.subject.isAdmin !== true &&
      factor.status === "active" &&
      factor.type === "totp"
    ) {
      if (input.code === undefined)
        throw new ApiError(
          "local_mfa_code_required",
          "MFA code is required to disable an active factor.",
          400,
        );
      const secret = this.mfaVault().decrypt(
        factor.secretEncrypted,
        localMfaSecretContext(factor),
      );
      if (!(await verifyTotpCode({ secret, code: input.code }))) {
        throw new ApiError(
          "local_mfa_code_invalid",
          "MFA code is invalid.",
          401,
        );
      }
    }
    const now = new Date().toISOString();
    const disabled = await this.repository.transaction(async (repository) => {
      const disabled = await repository.updateLocalMfaFactor({
        ...factor,
        status: "disabled",
        disabledAt: now,
        updatedAt: now,
      });
      await this.audit.write(
        {
          orgId: input.subject.orgId,
          actorId: input.subject.id,
          action: "local_auth.mfa.disable",
          resourceType: "local_mfa_factor",
          resourceId: disabled.id,
          metadata: { type: disabled.type },
        },
        repository,
      );
      return disabled;
    });
    return toFactorSummary(disabled, this.recoveryCodeRemainingCount(disabled));
  }

  private async activeTotpFactors(
    orgId: string,
    userId: string,
  ): Promise<LocalMfaFactor[]> {
    return (await this.repository.listLocalMfaFactors(orgId, userId)).filter(
      (factor) => factor.type === "totp" && factor.status === "active",
    );
  }

  async activeMfaPosture(
    orgId: string,
    userId: string,
  ): Promise<{
    factorCount: number;
    methods: LocalMfaMethod[];
  }> {
    return summarizeLocalMfaPosture(
      await this.repository.listLocalMfaFactors(orgId, userId),
      (factor) => this.recoveryCodeRemainingCount(factor),
    );
  }

  async satisfyMfaForLogin(input: {
    recoveryCode?: string;
    totpCode?: string;
    user: User;
  }): Promise<void> {
    if (input.totpCode !== undefined && input.recoveryCode !== undefined) {
      throw new ApiError(
        "local_mfa_single_method_required",
        "Provide one MFA method.",
        400,
      );
    }
    if (input.totpCode !== undefined) {
      const factors = await this.activeTotpFactors(
        input.user.orgId,
        input.user.id,
      );
      try {
        await this.assertValidTotpCode(factors, input.totpCode);
        return;
      } catch (error) {
        await this.audit.loginFailure(input.user, "invalid_mfa_code", {
          factorType: "totp",
        });
        throw error;
      }
    }
    if (input.recoveryCode !== undefined) {
      const consumed = await this.consumeRecoveryCodeForUser(
        input.user,
        input.recoveryCode,
      );
      if (consumed) return;
      await this.audit.loginFailure(input.user, "invalid_mfa_code", {
        factorType: "recovery_code",
      });
      throw new ApiError(
        "local_mfa_recovery_code_invalid",
        "MFA recovery code is invalid.",
        401,
      );
    }
    throw invalidLocalLogin();
  }

  private async consumeRecoveryCodeForUser(
    user: User,
    recoveryCode: string,
  ): Promise<boolean> {
    const factors = (
      await this.repository.listLocalMfaFactors(user.orgId, user.id)
    ).filter(
      (factor) =>
        factor.type === "recovery_codes" && factor.status === "active",
    );
    const now = new Date().toISOString();
    for (const factor of factors) {
      const envelope = this.parseRecoveryCodeEnvelope(factor);
      if (envelope === undefined) continue;
      const result = consumeLocalMfaRecoveryCode(envelope, recoveryCode, now);
      if (!result.consumed) continue;
      const remainingCount = localMfaRecoveryCodeRemainingCount(
        result.envelope,
      );
      const didConsume = await this.repository.transaction(
        async (repository) => {
          const consumedFactor = await repository.consumeLocalMfaFactor({
            expectedSecretEncrypted: factor.secretEncrypted,
            factor: {
              ...factor,
              secretEncrypted: this.mfaVault().encrypt(
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
          await this.audit.write(
            {
              orgId: user.orgId,
              actorId: user.id,
              action: "local_auth.mfa.recovery_code.consume",
              resourceType: "local_mfa_factor",
              resourceId: factor.id,
              metadata: {
                type: "recovery_codes",
                remainingCount,
              },
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

  recoveryCodeRemainingCount(factor: LocalMfaFactor): number | undefined {
    if (factor.type !== "recovery_codes") return undefined;
    const envelope = this.parseRecoveryCodeEnvelope(factor);
    return envelope === undefined
      ? 0
      : localMfaRecoveryCodeRemainingCount(envelope);
  }

  private parseRecoveryCodeEnvelope(
    factor: LocalMfaFactor,
  ): ReturnType<typeof parseLocalMfaRecoveryCodeEnvelope> | undefined {
    try {
      return parseLocalMfaRecoveryCodeEnvelope(
        this.mfaVault().decrypt(
          factor.secretEncrypted,
          localMfaSecretContext(factor),
        ),
      );
    } catch {
      return undefined;
    }
  }

  private async disableActiveRecoveryCodeFactors(
    repository: RomeoRepository,
    orgId: string,
    userId: string,
    disabledAt: string,
  ): Promise<void> {
    const factors = await repository.listLocalMfaFactors(orgId, userId);
    await Promise.all(
      factors
        .filter(
          (factor) =>
            factor.type === "recovery_codes" && factor.status === "active",
        )
        .map((factor) =>
          repository.updateLocalMfaFactor({
            ...factor,
            status: "disabled",
            disabledAt,
            updatedAt: disabledAt,
          }),
        ),
    );
  }

  private async assertValidTotpCode(
    factors: LocalMfaFactor[],
    code: string,
  ): Promise<void> {
    for (const factor of factors) {
      const secret = this.mfaVault().decrypt(
        factor.secretEncrypted,
        localMfaSecretContext(factor),
      );
      if (await verifyTotpCode({ secret, code })) {
        await this.repository.updateLocalMfaFactor({
          ...factor,
          lastUsedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        return;
      }
    }
    throw new ApiError("local_mfa_code_invalid", "MFA code is invalid.", 401);
  }

  private mfaVault(): LocalMfaSecretVault {
    return new LocalMfaSecretVault(
      this.env.LOCAL_AUTH_SECRET_ENCRYPTION_KEY || this.env.SESSION_SECRET,
    );
  }
}

function localMfaSecretContext(factor: LocalMfaFactor) {
  return {
    factorId: factor.id,
    factorType: factor.type,
    orgId: factor.orgId,
    userId: factor.userId,
  };
}

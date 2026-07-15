import { createHmac, timingSafeEqual } from "node:crypto";
import { assertScope, type AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";

import type {
  LocalMfaFactor,
  LocalPasswordCredential,
  User,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { createTotpEnrollmentSecret, verifyTotpCode } from "./local-mfa";
import {
  consumeLocalMfaRecoveryCode,
  generateLocalMfaRecoveryCodes,
  localMfaRecoveryCodeRemainingCount,
  parseLocalMfaRecoveryCodeEnvelope,
  serializeLocalMfaRecoveryCodeEnvelope,
} from "./local-mfa-recovery-codes";
import { LocalMfaSecretVault } from "./local-mfa-secret-vault";
import {
  assertLocalPasswordPolicy,
  burnLocalPasswordHash,
  hashLocalPassword,
  localPasswordNeedsRehash,
  normalizeLocalAuthEmail,
  verifyLocalPassword,
} from "./local-password";
import type {
  CreatedUserSession,
  SessionService,
  UserSessionSummary,
} from "./session-service";
import { createUserAuthSubject } from "./auth-subject";
import { ensureSystemAuditActor } from "./system-audit-actor";

type LocalMfaMethod = "recovery_code" | "totp";

export type LocalLoginResult =
  | {
      status: "authenticated";
      session: UserSessionSummary;
      token: string;
    }
  | {
      status: "mfa_required";
      challengeToken: string;
      expiresAt: string;
      methods: LocalMfaMethod[];
    };

export interface LocalAuthStatus {
  factors: LocalMfaFactorSummary[];
  hasPassword: boolean;
  mfaEnabled: boolean;
  role: User["role"];
}

export interface LocalMfaFactorSummary {
  id: string;
  type: LocalMfaFactor["type"];
  name: string;
  status: LocalMfaFactor["status"];
  createdAt: string;
  confirmedAt?: string;
  disabledAt?: string;
  lastUsedAt?: string;
  recoveryCodeRemainingCount?: number;
}

export interface TotpEnrollment {
  factor: LocalMfaFactorSummary;
  otpauthUri: string;
  secret: string;
}

export interface LocalMfaRecoveryCodes {
  factor: LocalMfaFactorSummary;
  codes: string[];
  recoveryCodeRemainingCount: number;
}

const defaultOrgId = "org_default";
const maxFailedAttempts = 10;
const lockoutMs = 15 * 60 * 1000;
const mfaChallengeTtlMs = 5 * 60 * 1000;

export class LocalAuthService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly sessions: SessionService,
    private readonly env: RomeoEnv,
  ) {}

  async status(subject: AuthSubject): Promise<LocalAuthStatus> {
    assertScope(subject, "me:read");
    if (subject.type !== "user")
      throw new ApiError(
        "local_auth_user_required",
        "Local auth status is only available for users.",
        403,
      );
    const user = await this.requireSubjectUser(subject);
    return this.statusForUser(user);
  }

  async login(input: {
    email: string;
    orgId?: string;
    password: string;
    recoveryCode?: string;
    totpCode?: string;
  }): Promise<LocalLoginResult> {
    const orgId = input.orgId ?? defaultOrgId;
    const emailNormalized = normalizeLocalAuthEmail(input.email);
    const credential = await this.repository.getLocalPasswordCredentialByEmail(
      orgId,
      emailNormalized,
    );
    if (credential === undefined) {
      await burnLocalPasswordHash(input.password);
      await this.auditUnknownLoginFailure(orgId, emailNormalized);
      throw invalidLocalLogin();
    }
    const user = await this.repository.getCurrentUser(credential.userId);
    if (user === undefined || user.orgId !== orgId) {
      await burnLocalPasswordHash(input.password);
      throw invalidLocalLogin();
    }
    if (user.disabledAt !== undefined) {
      await burnLocalPasswordHash(input.password);
      await this.auditLoginFailure(user, "user_disabled");
      throw invalidLocalLogin();
    }
    if (isCredentialLocked(credential)) {
      await this.auditLoginFailure(user, "credential_locked");
      throw invalidLocalLogin();
    }
    const passwordValid = await verifyLocalPassword(
      input.password,
      credential.passwordHash,
    );
    if (!passwordValid) {
      const result = await this.recordFailedPasswordAttempt(credential);
      await this.auditLoginFailure(user, "invalid_password", {
        locked: result.locked,
      });
      throw invalidLocalLogin();
    }

    const resetCredential =
      await this.updateCredentialAfterSuccessfulPasswordCheck(
        credential,
        input.password,
      );
    const mfaPosture = await this.activeMfaPosture(user.orgId, user.id);
    if (mfaPosture.methods.length > 0) {
      if (input.totpCode === undefined && input.recoveryCode === undefined) {
        const challenge = this.createMfaChallengeToken({
          orgId: user.orgId,
          userId: user.id,
        });
        await this.audit({
          orgId: user.orgId,
          actorId: user.id,
          action: "local_auth.login.mfa_required",
          resourceType: "user",
          resourceId: user.id,
          metadata: {
            factorCount: mfaPosture.factorCount,
            methods: mfaPosture.methods,
          },
        });
        return {
          status: "mfa_required",
          challengeToken: challenge.token,
          expiresAt: challenge.expiresAt,
          methods: mfaPosture.methods,
        };
      }
      await this.satisfyMfaForLogin({
        user,
        ...(input.totpCode === undefined ? {} : { totpCode: input.totpCode }),
        ...(input.recoveryCode === undefined
          ? {}
          : { recoveryCode: input.recoveryCode }),
      });
    }

    const session = await this.createSessionForUser(user);
    await this.audit({
      orgId: user.orgId,
      actorId: user.id,
      action: "local_auth.login",
      resourceType: "user",
      resourceId: user.id,
      metadata: {
        mfaSatisfied: mfaPosture.methods.length > 0,
        passwordCredentialId: resetCredential.id,
      },
    });
    return { status: "authenticated", ...session };
  }

  async verifyMfaLogin(input: {
    challengeToken: string;
    code?: string;
    recoveryCode?: string;
  }): Promise<CreatedUserSession> {
    const challenge = this.verifyMfaChallengeToken(input.challengeToken);
    const user = await this.repository.getCurrentUser(challenge.userId);
    if (user === undefined || user.orgId !== challenge.orgId) {
      throw invalidLocalLogin();
    }
    if (user.disabledAt !== undefined) {
      await this.auditLoginFailure(user, "user_disabled");
      throw invalidLocalLogin();
    }
    const mfaPosture = await this.activeMfaPosture(user.orgId, user.id);
    if (mfaPosture.methods.length === 0) {
      await this.auditLoginFailure(user, "mfa_factor_unavailable");
      throw invalidLocalLogin();
    }
    await this.satisfyMfaForLogin({
      user,
      ...(input.code === undefined ? {} : { totpCode: input.code }),
      ...(input.recoveryCode === undefined
        ? {}
        : { recoveryCode: input.recoveryCode }),
    });
    const session = await this.createSessionForUser(user);
    await this.audit({
      orgId: user.orgId,
      actorId: user.id,
      action: "local_auth.login",
      resourceType: "user",
      resourceId: user.id,
      metadata: { mfaSatisfied: true, challenge: "mfa" },
    });
    return session;
  }

  async setOwnPassword(input: {
    subject: AuthSubject;
    currentPassword?: string;
    newPassword: string;
  }): Promise<LocalAuthStatus> {
    assertScope(input.subject, "me:read");
    if (input.subject.type !== "user")
      throw new ApiError(
        "local_auth_user_required",
        "Local passwords are only available for users.",
        403,
      );
    assertLocalPasswordPolicy(input.newPassword);
    const user = await this.requireSubjectUser(input.subject);
    const existing = await this.repository.getLocalPasswordCredentialByUserId(
      user.id,
    );
    if (existing !== undefined) {
      if (input.currentPassword === undefined)
        throw new ApiError(
          "current_password_required",
          "Current password is required to change a local password.",
          400,
        );
      const valid = await verifyLocalPassword(
        input.currentPassword,
        existing.passwordHash,
      );
      if (!valid) throw invalidCurrentPassword();
    }
    await this.repository.transaction(async (repository) => {
      await this.upsertPasswordCredential(
        repository,
        user,
        input.newPassword,
        existing,
      );
      await this.audit(
        {
          orgId: user.orgId,
          actorId: user.id,
          action: "local_auth.password.set",
          resourceType: "user",
          resourceId: user.id,
          metadata: { selfService: true },
        },
        repository,
      );
    });
    return this.status(input.subject);
  }

  async setUserPassword(input: {
    subject: AuthSubject;
    userId: string;
    confirmUserId: string;
    newPassword: string;
  }): Promise<LocalAuthStatus> {
    assertScope(input.subject, "admin:write");
    if (input.userId !== input.confirmUserId) {
      throw new ApiError(
        "local_password_user_confirmation_mismatch",
        "User confirmation does not match.",
        400,
      );
    }
    assertLocalPasswordPolicy(input.newPassword);
    const user = await this.repository.getCurrentUser(input.userId);
    if (!user || user.orgId !== input.subject.orgId) throw notFound("User");
    const existing = await this.repository.getLocalPasswordCredentialByUserId(
      user.id,
    );
    await this.repository.transaction(async (repository) => {
      await this.upsertPasswordCredential(
        repository,
        user,
        input.newPassword,
        existing,
      );
      await this.revokeUserSessions(
        repository,
        user.orgId,
        user.id,
        new Date().toISOString(),
      );
      await this.audit(
        {
          orgId: input.subject.orgId,
          actorId: input.subject.id,
          action: "local_auth.password.admin_set",
          resourceType: "user",
          resourceId: user.id,
          metadata: {},
        },
        repository,
      );
    });
    return this.statusForUser(user);
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
    const user = await this.requireSubjectUser(input.subject);
    const enrollment = createTotpEnrollmentSecret({ email: user.email });
    const now = new Date().toISOString();
    const factor = await this.repository.transaction(async (repository) => {
      const factor = await repository.createLocalMfaFactor({
        id: createId("mfa_factor"),
        orgId: user.orgId,
        userId: user.id,
        type: "totp",
        name: normalizeFactorName(input.name),
        status: "pending",
        secretEncrypted: this.mfaVault().encrypt(enrollment.secret),
        createdAt: now,
        updatedAt: now,
      });
      await this.audit(
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
    const factor = await this.requireOwnedFactor(input.subject, input.factorId);
    if (factor.status !== "pending") {
      throw new ApiError(
        "local_mfa_factor_not_pending",
        "MFA factor is not pending confirmation.",
        409,
      );
    }
    const secret = this.mfaVault().decrypt(factor.secretEncrypted);
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
      await this.audit(
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
    const user = await this.requireSubjectUser(input.subject);
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
      const factor = await repository.createLocalMfaFactor({
        id: createId("mfa_recovery_codes"),
        orgId: user.orgId,
        userId: user.id,
        type: "recovery_codes",
        name: "Recovery codes",
        status: "active",
        secretEncrypted: this.mfaVault().encrypt(
          serializeLocalMfaRecoveryCodeEnvelope(generated.envelope),
        ),
        confirmedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      await this.audit(
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
    const factor = await this.requireOwnedFactor(input.subject, input.factorId);
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
      const secret = this.mfaVault().decrypt(factor.secretEncrypted);
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
      await this.audit(
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

  private async createSessionForUser(user: User): Promise<CreatedUserSession> {
    const subject = await createUserAuthSubject(this.repository, user);
    return this.sessions.create({
      subject,
      name: "Local password login",
      ttlHours: 12,
    });
  }

  private async statusForUser(user: User): Promise<LocalAuthStatus> {
    const [credential, factors] = await Promise.all([
      this.repository.getLocalPasswordCredentialByUserId(user.id),
      this.repository.listLocalMfaFactors(user.orgId, user.id),
    ]);
    const activePosture = await this.activeMfaPostureFromFactors(factors);
    return {
      hasPassword: credential !== undefined,
      mfaEnabled: activePosture.methods.length > 0,
      factors: factors.map((factor) =>
        toFactorSummary(factor, this.recoveryCodeRemainingCount(factor)),
      ),
      role: user.role ?? "user",
    };
  }

  private async requireSubjectUser(subject: AuthSubject): Promise<User> {
    const user = await this.repository.getCurrentUser(subject.id);
    if (
      user === undefined ||
      user.orgId !== subject.orgId ||
      user.disabledAt !== undefined
    )
      throw notFound("User");
    return user;
  }

  private async requireOwnedFactor(
    subject: AuthSubject,
    factorId: string,
  ): Promise<LocalMfaFactor> {
    if (subject.type !== "user")
      throw new ApiError(
        "local_auth_user_required",
        "Local MFA is only available for users.",
        403,
      );
    const factor = await this.repository.getLocalMfaFactor(factorId);
    if (
      factor === undefined ||
      factor.orgId !== subject.orgId ||
      (factor.userId !== subject.id && subject.isAdmin !== true)
    )
      throw notFound("MFA factor");
    return factor;
  }

  private async upsertPasswordCredential(
    repository: RomeoRepository,
    user: User,
    password: string,
    existing: LocalPasswordCredential | undefined,
  ): Promise<LocalPasswordCredential> {
    const now = new Date().toISOString();
    const passwordHash = await hashLocalPassword(password);
    if (existing !== undefined) {
      const credential: LocalPasswordCredential = {
        ...existing,
        emailNormalized: normalizeLocalAuthEmail(user.email),
        failedAttemptCount: 0,
        passwordHash,
        passwordUpdatedAt: now,
        updatedAt: now,
      };
      delete credential.lockedUntil;
      return repository.updateLocalPasswordCredential(credential);
    }
    return repository.createLocalPasswordCredential({
      id: createId("local_password"),
      orgId: user.orgId,
      userId: user.id,
      emailNormalized: normalizeLocalAuthEmail(user.email),
      passwordHash,
      failedAttemptCount: 0,
      passwordUpdatedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }

  private async updateCredentialAfterSuccessfulPasswordCheck(
    credential: LocalPasswordCredential,
    password: string,
  ): Promise<LocalPasswordCredential> {
    const unlocked =
      credential.failedAttemptCount === 0 &&
      credential.lockedUntil === undefined
        ? credential
        : unlockedPasswordCredential(credential);
    if (!localPasswordNeedsRehash(unlocked.passwordHash)) {
      if (unlocked === credential) return credential;
      return this.repository.updateLocalPasswordCredential(unlocked);
    }
    const now = new Date().toISOString();
    return this.repository.updateLocalPasswordCredential({
      ...unlocked,
      passwordHash: await hashLocalPassword(password),
      passwordUpdatedAt: now,
      updatedAt: now,
    });
  }

  private async recordFailedPasswordAttempt(
    credential: LocalPasswordCredential,
  ): Promise<{ locked: boolean }> {
    const failedAttemptCount = credential.failedAttemptCount + 1;
    const now = new Date();
    const update: LocalPasswordCredential = {
      ...credential,
      failedAttemptCount,
      updatedAt: now.toISOString(),
    };
    if (failedAttemptCount >= maxFailedAttempts) {
      update.lockedUntil = new Date(now.getTime() + lockoutMs).toISOString();
    }
    await this.repository.updateLocalPasswordCredential(update);
    return { locked: update.lockedUntil !== undefined };
  }

  private async activeTotpFactors(
    orgId: string,
    userId: string,
  ): Promise<LocalMfaFactor[]> {
    return (await this.repository.listLocalMfaFactors(orgId, userId)).filter(
      (factor) => factor.type === "totp" && factor.status === "active",
    );
  }

  private async activeMfaPosture(
    orgId: string,
    userId: string,
  ): Promise<{
    factorCount: number;
    methods: LocalMfaMethod[];
  }> {
    return this.activeMfaPostureFromFactors(
      await this.repository.listLocalMfaFactors(orgId, userId),
    );
  }

  private async activeMfaPostureFromFactors(
    factors: LocalMfaFactor[],
  ): Promise<{
    factorCount: number;
    methods: LocalMfaMethod[];
  }> {
    const activeTotpCount = factors.filter(
      (factor) => factor.type === "totp" && factor.status === "active",
    ).length;
    const activeRecoveryCount = factors.filter(
      (factor) =>
        factor.type === "recovery_codes" &&
        factor.status === "active" &&
        (this.recoveryCodeRemainingCount(factor) ?? 0) > 0,
    ).length;
    const methods: LocalMfaMethod[] = [];
    if (activeTotpCount > 0) methods.push("totp");
    if (activeRecoveryCount > 0) methods.push("recovery_code");
    return { factorCount: activeTotpCount + activeRecoveryCount, methods };
  }

  private async satisfyMfaForLogin(input: {
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
        await this.auditLoginFailure(input.user, "invalid_mfa_code", {
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
      await this.auditLoginFailure(input.user, "invalid_mfa_code", {
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
      await this.repository.transaction(async (repository) => {
        await repository.updateLocalMfaFactor({
          ...factor,
          secretEncrypted: this.mfaVault().encrypt(
            serializeLocalMfaRecoveryCodeEnvelope(result.envelope),
          ),
          status: remainingCount === 0 ? "disabled" : "active",
          ...(remainingCount === 0 ? { disabledAt: now } : {}),
          lastUsedAt: now,
          updatedAt: now,
        });
        await this.audit(
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
      });
      return true;
    }
    return false;
  }

  private recoveryCodeRemainingCount(
    factor: LocalMfaFactor,
  ): number | undefined {
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
        this.mfaVault().decrypt(factor.secretEncrypted),
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
      const secret = this.mfaVault().decrypt(factor.secretEncrypted);
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

  private async revokeUserSessions(
    repository: RomeoRepository,
    orgId: string,
    userId: string,
    revokedAt: string,
  ): Promise<void> {
    const sessions = await repository.listUserSessions(orgId, userId);
    await Promise.all(
      sessions
        .filter((session) => session.revokedAt === undefined)
        .map((session) =>
          repository.updateUserSession({ ...session, revokedAt }),
        ),
    );
  }

  private mfaVault(): LocalMfaSecretVault {
    return new LocalMfaSecretVault(
      this.env.LOCAL_AUTH_SECRET_ENCRYPTION_KEY || this.env.SESSION_SECRET,
    );
  }

  private createMfaChallengeToken(input: { orgId: string; userId: string }): {
    expiresAt: string;
    token: string;
  } {
    const expiresAt = new Date(Date.now() + mfaChallengeTtlMs).toISOString();
    const payload = Buffer.from(
      JSON.stringify({
        v: 1,
        orgId: input.orgId,
        userId: input.userId,
        exp: expiresAt,
      }),
    ).toString("base64url");
    return {
      expiresAt,
      token: `lmc_${payload}.${this.signChallenge(payload)}`,
    };
  }

  private verifyMfaChallengeToken(token: string): {
    orgId: string;
    userId: string;
  } {
    if (!token.startsWith("lmc_")) throw invalidLocalLogin();
    const [payload, signature] = token.slice("lmc_".length).split(".");
    if (payload === undefined || signature === undefined)
      throw invalidLocalLogin();
    if (!timingSafeStringEqual(signature, this.signChallenge(payload)))
      throw invalidLocalLogin();
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as { exp?: unknown; orgId?: unknown; userId?: unknown; v?: unknown };
    if (
      parsed.v !== 1 ||
      typeof parsed.orgId !== "string" ||
      typeof parsed.userId !== "string" ||
      typeof parsed.exp !== "string" ||
      new Date(parsed.exp).getTime() <= Date.now()
    )
      throw invalidLocalLogin();
    return { orgId: parsed.orgId, userId: parsed.userId };
  }

  private signChallenge(payload: string): string {
    return createHmac("sha256", this.env.SESSION_SECRET)
      .update("romeo-local-mfa-challenge-v1", "utf8")
      .update(payload, "utf8")
      .digest("base64url");
  }

  private async audit(
    input: {
      action: string;
      actorId: string;
      metadata: Record<string, unknown>;
      orgId: string;
      outcome?: "failure" | "success";
      resourceId: string;
      resourceType: string;
    },
    repository: RomeoRepository = this.repository,
  ): Promise<void> {
    await repository.createAuditLog({
      id: createId("audit"),
      orgId: input.orgId,
      actorId: input.actorId,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      outcome: input.outcome ?? "success",
      metadata: input.metadata,
      createdAt: new Date().toISOString(),
    });
  }

  private async auditLoginFailure(
    user: User,
    failureClass:
      | "credential_locked"
      | "invalid_mfa_code"
      | "invalid_password"
      | "mfa_factor_unavailable"
      | "user_disabled",
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.audit({
      orgId: user.orgId,
      actorId: user.id,
      action: "local_auth.login.failure",
      resourceType: "user",
      resourceId: user.id,
      outcome: "failure",
      metadata: {
        providerId: "local",
        failureClass,
        ...metadata,
      },
    });
  }

  private async auditUnknownLoginFailure(
    orgId: string,
    emailNormalized: string,
  ): Promise<void> {
    try {
      const actor = await ensureSystemAuditActor(this.repository, {
        kind: "local_auth",
        name: "Romeo system local authentication",
        orgId,
      });
      await this.audit({
        orgId,
        actorId: actor.id,
        action: "local_auth.login.failure",
        resourceType: "auth_principal",
        resourceId: "unknown_local_principal",
        outcome: "failure",
        metadata: {
          providerId: "local",
          failureClass: "unknown_principal",
          identifierHash: this.localAuthIdentifierHash(emailNormalized),
          identifierHashAlgorithm: "hmac-sha256",
        },
      });
    } catch {
      // Unknown-principal login responses must remain indistinguishable even if
      // the target organization has not been bootstrapped for audit actors yet.
    }
  }

  private localAuthIdentifierHash(emailNormalized: string): string {
    return createHmac(
      "sha256",
      this.env.LOCAL_AUTH_SECRET_ENCRYPTION_KEY || this.env.SESSION_SECRET,
    )
      .update("romeo-local-auth-identifier-v1", "utf8")
      .update(emailNormalized, "utf8")
      .digest("hex");
  }
}

function invalidLocalLogin(): ApiError {
  return new ApiError(
    "local_login_invalid",
    "Email, password, or MFA code is invalid.",
    401,
  );
}

function invalidCurrentPassword(): ApiError {
  return new ApiError(
    "current_password_invalid",
    "Current password is invalid.",
    401,
  );
}

function normalizeFactorName(name: string | undefined): string {
  const normalized = name?.trim();
  return normalized === undefined || normalized.length === 0
    ? "Authenticator app"
    : normalized.slice(0, 120);
}

function toFactorSummary(
  factor: LocalMfaFactor,
  recoveryCodeRemainingCount?: number,
): LocalMfaFactorSummary {
  const summary: LocalMfaFactorSummary = {
    id: factor.id,
    type: factor.type,
    name: factor.name,
    status: factor.status,
    createdAt: factor.createdAt,
  };
  if (factor.confirmedAt !== undefined)
    summary.confirmedAt = factor.confirmedAt;
  if (factor.disabledAt !== undefined) summary.disabledAt = factor.disabledAt;
  if (factor.lastUsedAt !== undefined) summary.lastUsedAt = factor.lastUsedAt;
  if (recoveryCodeRemainingCount !== undefined)
    summary.recoveryCodeRemainingCount = recoveryCodeRemainingCount;
  return summary;
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.byteLength === rightBytes.byteLength &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function isCredentialLocked(credential: LocalPasswordCredential): boolean {
  return (
    credential.lockedUntil !== undefined &&
    new Date(credential.lockedUntil).getTime() > Date.now()
  );
}

function unlockedPasswordCredential(
  credential: LocalPasswordCredential,
): LocalPasswordCredential {
  const unlocked: LocalPasswordCredential = {
    ...credential,
    failedAttemptCount: 0,
    updatedAt: new Date().toISOString(),
  };
  delete unlocked.lockedUntil;
  return unlocked;
}

import { assertScope, type AuthSubject } from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";

import type { LocalPasswordCredential, User } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import {
  assertLocalPasswordPolicy,
  burnLocalPasswordHash,
  hashLocalPassword,
  localPasswordNeedsRehash,
  normalizeLocalAuthEmail,
  verifyLocalPassword,
} from "./local-password";
import type { CreatedUserSession, SessionService } from "./session-service";
import { createUserAuthSubject } from "./auth-subject";
import { LocalAuthAudit } from "./local-auth-audit";
import {
  invalidCurrentPassword,
  invalidLocalLogin,
  isCredentialLocked,
  unlockedPasswordCredential,
} from "./local-auth-errors";
import { LocalMfaChallengeCodec } from "./local-mfa-challenge";
import { LocalMfaService } from "./local-mfa-service";
import type {
  LocalAuthStatus,
  LocalLoginResult,
  LocalMfaRecoveryCodes,
  TotpEnrollment,
} from "./local-auth-types";
export type {
  LocalAuthStatus,
  LocalLoginResult,
  LocalMfaFactorSummary,
  LocalMfaRecoveryCodes,
  TotpEnrollment,
} from "./local-auth-types";

const defaultOrgId = "org_default";
const maxFailedAttempts = 10;
const lockoutMs = 15 * 60 * 1000;

export class LocalAuthService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly sessions: SessionService,
    private readonly env: RomeoEnv,
  ) {
    this.audit = new LocalAuthAudit(repository, env);
    this.mfa = new LocalMfaService(repository, env);
    this.challenge = new LocalMfaChallengeCodec(env);
  }

  private readonly audit: LocalAuthAudit;
  private readonly mfa: LocalMfaService;
  private readonly challenge: LocalMfaChallengeCodec;

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
      await this.audit.unknownLoginFailure(orgId, emailNormalized);
      throw invalidLocalLogin();
    }
    const user = await this.repository.getCurrentUser(credential.userId);
    if (user === undefined || user.orgId !== orgId) {
      await burnLocalPasswordHash(input.password);
      throw invalidLocalLogin();
    }
    if (user.disabledAt !== undefined) {
      await burnLocalPasswordHash(input.password);
      await this.audit.loginFailure(user, "user_disabled");
      throw invalidLocalLogin();
    }
    if (isCredentialLocked(credential)) {
      await this.audit.loginFailure(user, "credential_locked");
      throw invalidLocalLogin();
    }
    const passwordValid = await verifyLocalPassword(
      input.password,
      credential.passwordHash,
    );
    if (!passwordValid) {
      const result = await this.recordFailedPasswordAttempt(credential);
      await this.audit.loginFailure(user, "invalid_password", {
        locked: result.locked,
      });
      throw invalidLocalLogin();
    }

    const resetCredential =
      await this.updateCredentialAfterSuccessfulPasswordCheck(
        credential,
        input.password,
      );
    const mfaPosture = await this.mfa.activeMfaPosture(user.orgId, user.id);
    if (mfaPosture.methods.length > 0) {
      if (input.totpCode === undefined && input.recoveryCode === undefined) {
        const challenge = this.challenge.create({
          orgId: user.orgId,
          userId: user.id,
        });
        await this.repository.createLocalMfaChallenge({
          id: challenge.challengeId,
          orgId: user.orgId,
          userId: user.id,
          expiresAt: challenge.expiresAt,
          createdAt: new Date().toISOString(),
        });
        await this.audit.write({
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
      await this.mfa.satisfyMfaForLogin({
        user,
        ...(input.totpCode === undefined ? {} : { totpCode: input.totpCode }),
        ...(input.recoveryCode === undefined
          ? {}
          : { recoveryCode: input.recoveryCode }),
      });
    }

    const session = await this.createSessionForUser(user);
    await this.audit.write({
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
    const challenge = this.challenge.verify(input.challengeToken);
    const user = await this.repository.getCurrentUser(challenge.userId);
    if (user === undefined || user.orgId !== challenge.orgId) {
      throw invalidLocalLogin();
    }
    if (user.disabledAt !== undefined) {
      await this.audit.loginFailure(user, "user_disabled");
      throw invalidLocalLogin();
    }
    const mfaPosture = await this.mfa.activeMfaPosture(user.orgId, user.id);
    if (mfaPosture.methods.length === 0) {
      await this.audit.loginFailure(user, "mfa_factor_unavailable");
      throw invalidLocalLogin();
    }
    await this.mfa.satisfyMfaForLogin({
      user,
      ...(input.code === undefined ? {} : { totpCode: input.code }),
      ...(input.recoveryCode === undefined
        ? {}
        : { recoveryCode: input.recoveryCode }),
    });
    const consumed = await this.repository.consumeLocalMfaChallenge({
      id: challenge.challengeId,
      orgId: challenge.orgId,
      userId: challenge.userId,
      consumedAt: new Date().toISOString(),
    });
    if (consumed === undefined) throw invalidLocalLogin();
    const session = await this.createSessionForUser(user);
    await this.audit.write({
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
      await this.revokeUserSessions(
        repository,
        user.orgId,
        user.id,
        new Date().toISOString(),
      );
      await this.audit.write(
        {
          orgId: user.orgId,
          actorId: user.id,
          action: "local_auth.password.set",
          resourceType: "user",
          resourceId: user.id,
          metadata: { selfService: true, sessionsRevoked: true },
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
      await this.audit.write(
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
    return this.mfa.startTotpEnrollment(input);
  }

  async confirmTotpEnrollment(input: {
    subject: AuthSubject;
    factorId: string;
    code: string;
  }) {
    return this.mfa.confirmTotpEnrollment(input);
  }

  async generateRecoveryCodes(input: {
    subject: AuthSubject;
    totpCode: string;
  }): Promise<LocalMfaRecoveryCodes> {
    return this.mfa.generateRecoveryCodes(input);
  }

  async disableTotpFactor(input: {
    subject: AuthSubject;
    factorId: string;
    code?: string;
  }) {
    return this.mfa.disableTotpFactor(input);
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
      this.mfa.factorSummaries(user.orgId, user.id),
    ]);
    const posture = await this.mfa.activeMfaPosture(user.orgId, user.id);
    return {
      hasPassword: credential !== undefined,
      mfaEnabled: posture.methods.length > 0,
      factors,
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
    const now = new Date();
    const update = await this.repository.recordFailedLocalPasswordAttempt({
      credentialId: credential.id,
      attemptedAt: now.toISOString(),
      lockedUntil: new Date(now.getTime() + lockoutMs).toISOString(),
      maxFailedAttempts,
    });
    return { locked: update?.lockedUntil !== undefined };
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
}

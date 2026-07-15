import { assertScope, type AuthSubject, type UserRole } from "@romeo/auth";

import type { User, UserSession } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { normalizeUserRole } from "./auth-subject";
import { normalizeLocalAuthEmail } from "./local-password";

export class UserLifecycleService {
  constructor(private readonly repository: RomeoRepository) {}

  async list(subject: AuthSubject): Promise<User[]> {
    assertScope(subject, "admin:read");
    return this.repository.listUsers(subject.orgId);
  }

  async updateCurrentProfile(input: {
    subject: AuthSubject;
    email?: string;
    name?: string;
  }): Promise<User> {
    assertScope(input.subject, "me:read");
    if (input.subject.type !== "user") {
      throw new ApiError(
        "user_profile_user_required",
        "Profile updates are only available for users.",
        403,
      );
    }
    if (input.subject.supportSession !== undefined) {
      throw new ApiError(
        "support_session_profile_update_forbidden",
        "Support sessions cannot update user profile fields.",
        403,
      );
    }
    return this.repository.transaction(async (repository) => {
      const user = await repository.getCurrentUser(input.subject.id);
      if (
        !user ||
        user.orgId !== input.subject.orgId ||
        user.disabledAt !== undefined
      )
        throw notFound("User");

      const email =
        input.email === undefined
          ? user.email
          : normalizeLocalAuthEmail(input.email);
      const name = input.name === undefined ? user.name : input.name.trim();
      if (name.length === 0) {
        throw new ApiError(
          "invalid_user_profile_name",
          "Profile names cannot be blank.",
          400,
        );
      }

      const emailChanged = email !== user.email;
      const nameChanged = name !== user.name;
      if (!emailChanged && !nameChanged) return user;

      if (emailChanged) {
        const [users, credentialByEmail] = await Promise.all([
          repository.listUsers(user.orgId),
          repository.getLocalPasswordCredentialByEmail(user.orgId, email),
        ]);
        if (
          users.some(
            (candidate) =>
              candidate.id !== user.id &&
              normalizeLocalAuthEmail(candidate.email) === email,
          )
        ) {
          throw new ApiError(
            "user_profile_email_conflict",
            "That email address is already in use.",
            409,
          );
        }
        if (
          credentialByEmail !== undefined &&
          credentialByEmail.userId !== user.id
        ) {
          throw new ApiError(
            "user_profile_email_conflict",
            "That email address is already in use.",
            409,
          );
        }
      }

      const now = new Date().toISOString();
      const updated = await repository.updateUser({ ...user, email, name });
      const localCredential = emailChanged
        ? await repository.getLocalPasswordCredentialByUserId(user.id)
        : undefined;
      if (localCredential !== undefined) {
        await repository.updateLocalPasswordCredential({
          ...localCredential,
          emailNormalized: email,
          updatedAt: now,
        });
      }
      await repository.createAuditLog({
        id: createId("audit"),
        orgId: user.orgId,
        actorId: user.id,
        action: "user.profile.update",
        resourceType: "user",
        resourceId: user.id,
        outcome: "success",
        metadata: {
          emailChanged,
          nameChanged,
          localPasswordCredentialEmailUpdated: localCredential !== undefined,
        },
        createdAt: now,
      });
      return updated;
    });
  }

  async disable(input: {
    subject: AuthSubject;
    userId: string;
  }): Promise<User> {
    assertScope(input.subject, "admin:write");
    if (input.userId === input.subject.id) {
      throw new ApiError(
        "user_self_disable_forbidden",
        "Admins cannot disable their own user.",
        403,
      );
    }
    const user = await this.repository.getCurrentUser(input.userId);
    if (!user || user.orgId !== input.subject.orgId) throw notFound("User");
    if (user.disabledAt !== undefined) return user;
    const now = new Date().toISOString();
    return this.repository.transaction(async (repository) => {
      const disabled = await repository.updateUser({
        ...user,
        disabledAt: now,
      });
      const revocation = await this.revokeUserCredentials(
        repository,
        input.subject.orgId,
        user.id,
        now,
      );
      await repository.createAuditLog({
        id: createId("audit"),
        orgId: input.subject.orgId,
        actorId: input.subject.id,
        action: "user.disable",
        resourceType: "user",
        resourceId: user.id,
        outcome: "success",
        metadata: {
          credentialRevocation: "user_api_keys_and_sessions",
          revokedApiKeyCount: revocation.apiKeyCount,
          revokedSessionCount: revocation.sessionCount,
          revokedOwnedSupportSessionCount: revocation.ownedSupportSessionCount,
        },
        createdAt: now,
      });
      return disabled;
    });
  }

  async updateRole(input: {
    subject: AuthSubject;
    userId: string;
    confirmUserId: string;
    role: UserRole;
  }): Promise<User> {
    assertScope(input.subject, "admin:write");
    if (input.userId !== input.confirmUserId) {
      throw new ApiError(
        "user_role_confirmation_mismatch",
        "User confirmation does not match.",
        400,
      );
    }
    if (input.userId === input.subject.id) {
      throw new ApiError(
        "user_self_role_change_forbidden",
        "Admins cannot change their own role.",
        403,
      );
    }
    const user = await this.repository.getCurrentUser(input.userId);
    if (!user || user.orgId !== input.subject.orgId) throw notFound("User");
    const currentRole = normalizeUserRole(user);
    if (input.role === "global_admin" || currentRole === "global_admin") {
      this.assertGlobalAdmin(input.subject);
    }
    const now = new Date().toISOString();
    return this.repository.transaction(async (repository) => {
      const updated = await repository.updateUser({
        ...user,
        role: input.role,
      });
      await this.revokeUserCredentials(repository, user.orgId, user.id, now);
      await repository.createAuditLog({
        id: createId("audit"),
        orgId: input.subject.orgId,
        actorId: input.subject.id,
        action: "user.role.update",
        resourceType: "user",
        resourceId: user.id,
        outcome: "success",
        metadata: {
          previousRole: currentRole,
          role: input.role,
          credentialRevocation: "user_api_keys_and_sessions",
        },
        createdAt: now,
      });
      return updated;
    });
  }

  private async revokeUserCredentials(
    repository: RomeoRepository,
    orgId: string,
    userId: string,
    revokedAt: string,
  ): Promise<{
    apiKeyCount: number;
    ownedSupportSessionCount: number;
    sessionCount: number;
  }> {
    const [apiKeys, sessions, ownedSupportSessionIds] = await Promise.all([
      repository.listApiKeys(orgId),
      repository.listUserSessions(orgId, userId),
      this.ownedSupportSessionIds(repository, orgId, userId),
    ]);
    const revokedApiKeys = apiKeys.filter(
      (key) => key.userId === userId && key.revokedAt === undefined,
    );
    const revokedSessions = sessions.filter(
      (session) => session.revokedAt === undefined,
    );
    const ownedSupportSessions = (
      await Promise.all(
        [...ownedSupportSessionIds].map((sessionId) =>
          repository.getUserSession(sessionId),
        ),
      )
    ).filter(
      (session): session is UserSession =>
        session !== undefined &&
        session.orgId === orgId &&
        session.userId !== userId &&
        session.revokedAt === undefined,
    );
    await Promise.all([
      ...apiKeys
        .filter((key) => key.userId === userId && key.revokedAt === undefined)
        .map((key) => repository.updateApiKey({ ...key, revokedAt })),
      ...revokedSessions.map((session) =>
        repository.updateUserSession({ ...session, revokedAt }),
      ),
      ...ownedSupportSessions.map((session) =>
        repository.updateUserSession({ ...session, revokedAt }),
      ),
    ]);
    return {
      apiKeyCount: revokedApiKeys.length,
      ownedSupportSessionCount: ownedSupportSessions.length,
      sessionCount: revokedSessions.length,
    };
  }

  private async ownedSupportSessionIds(
    repository: RomeoRepository,
    orgId: string,
    userId: string,
  ): Promise<Set<string>> {
    const logs = await repository.listAuditLogs(orgId);
    const sessionIds = new Set<string>();
    for (const log of logs) {
      if (
        log.action !== "support.impersonation.create" ||
        log.resourceType !== "session"
      ) {
        continue;
      }
      const requestedByUserId =
        typeof log.metadata.requestedByUserId === "string"
          ? log.metadata.requestedByUserId
          : undefined;
      if (log.actorId === userId || requestedByUserId === userId) {
        sessionIds.add(log.resourceId);
      }
    }
    return sessionIds;
  }

  private assertGlobalAdmin(subject: AuthSubject): void {
    if (subject.adminRole !== "global_admin") {
      throw new ApiError(
        "global_admin_required",
        "Global admin role is required for this operation.",
        403,
      );
    }
  }
}

import {
  AuthorizationError,
  assertScope,
  createSessionToken,
  hashApiKey,
  type AuthSubject,
} from "@romeo/auth";
import { AuthenticationError } from "../errors";

import type { UserSession } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { createId } from "../ids";
import { createUserAuthSubject } from "./auth-subject";
import { toSessionSummary } from "./session-summary";
import { SupportSessionService } from "./support-session-service";
import { sameScopes } from "./support-session-reporting";
import { supportSessionScopes } from "./support-session-infrastructure";
import type {
  SupportSessionReport,
  SupportSessionRequestReport,
} from "./support-session-types";
export type {
  SupportSessionReport,
  SupportSessionRequestReport,
} from "./support-session-types";

export type UserSessionSummary = Omit<UserSession, "hashedToken">;

export interface CreatedUserSession {
  session: UserSessionSummary;
  token: string;
}

export interface CreateUserSessionRequest {
  subject: AuthSubject;
  name: string;
  ttlHours?: number;
}

const sessionTokenPattern = /^rms_[a-f0-9]{48}$/;
export class SessionService {
  private readonly support: SupportSessionService;

  constructor(private readonly repository: RomeoRepository) {
    this.support = new SupportSessionService(repository);
  }

  async list(subject: AuthSubject): Promise<UserSessionSummary[]> {
    assertScope(subject, "me:read");
    if (subject.type !== "user")
      throw new AuthorizationError(
        "Local sessions are only available for user subjects.",
      );
    const sessions = await this.repository.listUserSessions(
      subject.orgId,
      subject.id,
    );
    return sessions.map(toSessionSummary);
  }

  async listSupportSessions(
    subject: AuthSubject,
  ): Promise<SupportSessionReport[]> {
    return this.support.listSupportSessions(subject);
  }

  async listSupportSessionRequests(
    subject: AuthSubject,
  ): Promise<SupportSessionRequestReport[]> {
    return this.support.listSupportSessionRequests(subject);
  }

  async revokeSupportSession(input: {
    subject: AuthSubject;
    sessionId: string;
  }): Promise<SupportSessionReport> {
    return this.support.revokeSupportSession(input);
  }

  async createSupportSession(input: {
    subject: AuthSubject;
    targetUserId: string;
    confirmTargetUserId: string;
    reason: string;
    ticketRef?: string;
    ttlMinutes?: number;
  }): Promise<CreatedUserSession> {
    return this.support.createSupportSession(input);
  }

  async requestSupportSession(input: {
    subject: AuthSubject;
    targetUserId: string;
    confirmTargetUserId: string;
    reason: string;
    ticketRef?: string;
    ttlMinutes?: number;
  }): Promise<SupportSessionRequestReport> {
    return this.support.requestSupportSession(input);
  }

  async approveSupportSessionRequest(input: {
    subject: AuthSubject;
    requestId: string;
  }): Promise<CreatedUserSession> {
    return this.support.approveSupportSessionRequest(input);
  }

  async rejectSupportSessionRequest(input: {
    subject: AuthSubject;
    requestId: string;
  }): Promise<SupportSessionRequestReport> {
    return this.support.rejectSupportSessionRequest(input);
  }

  async create(input: CreateUserSessionRequest): Promise<CreatedUserSession> {
    return this.repository.transaction((repository) =>
      this.createInRepository(repository, input),
    );
  }

  async createInRepository(
    repository: RomeoRepository,
    input: CreateUserSessionRequest,
  ): Promise<CreatedUserSession> {
    assertScope(input.subject, "me:read");
    if (input.subject.type !== "user")
      throw new AuthorizationError(
        "Local sessions are only available for user subjects.",
      );
    // A support/impersonation subject must not mint a fresh long-lived standard
    // session for the target user — that would escape the support-session TTL
    // cap and its per-request audit trail.
    if (input.subject.supportSession !== undefined)
      throw new AuthorizationError(
        "Support sessions cannot create new local sessions.",
      );
    const ttlHours = input.ttlHours ?? 12;
    if (!Number.isInteger(ttlHours) || ttlHours < 1 || ttlHours > 720) {
      throw new ApiError(
        "invalid_session_ttl",
        "Session TTL must be between 1 and 720 hours.",
        400,
      );
    }

    const now = new Date();
    const token = createSessionToken();
    const hashedToken = await hashApiKey(token);
    const created = await repository.createUserSession({
      id: createId("session"),
      orgId: input.subject.orgId,
      userId: input.subject.id,
      name: input.name,
      hashedToken,
      scopes: input.subject.scopes,
      isAdmin: input.subject.isAdmin === true,
      expiresAt: new Date(
        now.getTime() + ttlHours * 60 * 60 * 1000,
      ).toISOString(),
      createdAt: now.toISOString(),
    });

    await this.audit(
      input.subject,
      "session.create",
      created.id,
      {
        scopeCount: created.scopes.length,
        ttlHours,
      },
      { repository, createdAt: created.createdAt },
    );
    return { session: toSessionSummary(created), token };
  }

  async authenticate(token: string): Promise<AuthSubject> {
    if (!sessionTokenPattern.test(token))
      throw new AuthenticationError("Session token is invalid or revoked.");
    const session = await this.repository.getUserSessionByHash(
      await hashApiKey(token),
    );
    if (!session || session.revokedAt !== undefined)
      throw new AuthenticationError("Session token is invalid or revoked.");
    if (new Date(session.expiresAt).getTime() <= Date.now())
      throw new AuthenticationError("Session token is expired.");
    const user = await this.repository.getCurrentUser(session.userId);
    if (!user || user.orgId !== session.orgId)
      throw new AuthenticationError("Session owner was not found.");
    if (user.disabledAt !== undefined)
      throw new AuthenticationError("Session owner is disabled.");

    await this.touchSession(session);
    const supportSession = await this.supportSessionContext(session);
    return createUserAuthSubject(this.repository, user, {
      sessionId: session.id,
      sessionScopes: session.scopes,
      forceAdmin: session.isAdmin,
      ...(supportSession === undefined ? {} : { supportSession }),
    });
  }

  async auditSupportSessionRequest(input: {
    subject: AuthSubject;
    method: string;
    path: string;
    queryKeys: string[];
    resourceAccess?: {
      resourceType: string;
      resourceId: string;
      accessType: string;
    };
    requestId: string;
    status: number;
  }): Promise<void> {
    if (
      input.subject.supportSession === undefined ||
      input.subject.sessionId === undefined
    )
      return;
    await writeAuditLog(this.repository, {
      id: createId("audit"),
      orgId: input.subject.orgId,
      actorId: input.subject.id,
      action: "support.impersonation.request",
      resourceType: "session",
      resourceId: input.subject.sessionId,
      outcome: input.status < 400 ? "success" : "failure",
      metadata: {
        adminUserId: input.subject.supportSession.adminUserId,
        supportSessionCreatedAuditLogId:
          input.subject.supportSession.createdAuditLogId,
        method: input.method,
        path: input.path,
        status: input.status,
        queryKeys: input.queryKeys,
        requestId: input.requestId,
        ...(input.resourceAccess === undefined
          ? {}
          : {
              accessedResourceType: input.resourceAccess.resourceType,
              accessedResourceId: input.resourceAccess.resourceId,
              accessType: input.resourceAccess.accessType,
            }),
      },
      createdAt: new Date().toISOString(),
    });
  }

  async revokeCurrent(subject: AuthSubject): Promise<UserSessionSummary> {
    assertScope(subject, "me:read");
    if (subject.sessionId === undefined)
      throw new AuthorizationError(
        "Current request is not using a local session.",
      );
    const session = await this.repository.getUserSession(subject.sessionId);
    if (
      !session ||
      session.orgId !== subject.orgId ||
      session.userId !== subject.id
    ) {
      throw new AuthorizationError("Current session was not found.");
    }
    const revokedAt = new Date().toISOString();
    const revoked = await this.repository.transaction(async (repository) => {
      const updated = await repository.updateUserSession({
        ...session,
        revokedAt,
      });
      await this.audit(
        subject,
        "session.revoke",
        updated.id,
        {},
        {
          repository,
          createdAt: revokedAt,
        },
      );
      return updated;
    });
    return toSessionSummary(revoked);
  }

  async revoke(input: {
    subject: AuthSubject;
    sessionId: string;
  }): Promise<UserSessionSummary> {
    assertScope(input.subject, "me:read");
    if (input.subject.type !== "user")
      throw new AuthorizationError(
        "Local sessions are only available for user subjects.",
      );
    const session = await this.repository.getUserSession(input.sessionId);
    const ownsSession =
      session !== undefined &&
      session.orgId === input.subject.orgId &&
      session.userId === input.subject.id;
    if (!session || (!ownsSession && input.subject.isAdmin !== true)) {
      throw new ApiError("session_not_found", "Session was not found.", 404);
    }
    if (session.orgId !== input.subject.orgId) {
      throw new ApiError("session_not_found", "Session was not found.", 404);
    }
    if (session.revokedAt !== undefined) return toSessionSummary(session);
    const revokedAt = new Date().toISOString();
    const revoked = await this.repository.transaction(async (repository) => {
      const updated = await repository.updateUserSession({
        ...session,
        revokedAt,
      });
      await this.audit(
        input.subject,
        "session.revoke",
        updated.id,
        {
          targetUserId: updated.userId,
        },
        { repository, createdAt: revokedAt },
      );
      return updated;
    });
    return toSessionSummary(revoked);
  }

  async revokeOthers(subject: AuthSubject): Promise<UserSessionSummary[]> {
    assertScope(subject, "me:read");
    if (subject.type !== "user")
      throw new AuthorizationError(
        "Local sessions are only available for user subjects.",
      );
    const sessions = await this.repository.listUserSessions(
      subject.orgId,
      subject.id,
    );
    const revokedAt = new Date().toISOString();
    const revoked = await this.repository.transaction(async (repository) => {
      const updatedSessions: UserSessionSummary[] = [];
      for (const session of sessions) {
        if (session.id === subject.sessionId) continue;
        if (session.revokedAt !== undefined) continue;
        if (new Date(session.expiresAt).getTime() <= Date.now()) continue;
        const updated = await repository.updateUserSession({
          ...session,
          revokedAt,
        });
        await this.audit(
          subject,
          "session.revoke",
          updated.id,
          {
            targetUserId: updated.userId,
            ...(subject.sessionId === undefined
              ? {}
              : { exceptSessionId: subject.sessionId }),
          },
          { repository, createdAt: revokedAt },
        );
        updatedSessions.push(toSessionSummary(updated));
      }
      return updatedSessions;
    });
    return revoked;
  }

  private async touchSession(session: UserSession): Promise<void> {
    const lastSeen =
      session.lastSeenAt === undefined
        ? 0
        : new Date(session.lastSeenAt).getTime();
    if (Date.now() - lastSeen < 5 * 60 * 1000) return;
    await this.repository.updateUserSession({
      ...session,
      lastSeenAt: new Date().toISOString(),
    });
  }

  private async audit<A extends AuditAction>(
    subject: AuthSubject,
    action: A,
    resourceId: string,
    metadata: AuditMetadata<A>,
    options: {
      repository?: RomeoRepository;
      resourceType?: string;
      createdAt?: string;
    } = {},
  ): Promise<void> {
    await writeAuditLog(options.repository ?? this.repository, {
      id: createId("audit"),
      orgId: subject.orgId,
      actorId: subject.id,
      action,
      resourceType: options.resourceType ?? "session",
      resourceId,
      outcome: "success",
      metadata,
      createdAt: options.createdAt ?? new Date().toISOString(),
    });
  }

  private async supportSessionContext(
    session: UserSession,
  ): Promise<AuthSubject["supportSession"] | undefined> {
    if (
      session.isAdmin === true ||
      !sameScopes(session.scopes, supportSessionScopes)
    )
      return undefined;
    const logs = await this.repository.listAuditLogs(session.orgId);
    const createLog = logs.find(
      (log) =>
        log.action === "support.impersonation.create" &&
        log.resourceType === "session" &&
        log.resourceId === session.id,
    );
    if (createLog === undefined) return undefined;
    return { adminUserId: createLog.actorId, createdAuditLogId: createLog.id };
  }
}
import {
  type AuditAction,
  type AuditMetadata,
  writeAuditLog,
} from "./audit-log";

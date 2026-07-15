import { createHash } from "node:crypto";
import {
  AuthorizationError,
  assertScope,
  createSessionToken,
  hashApiKey,
  type AuthSubject,
  type Scope,
} from "@romeo/auth";

import type {
  AuditLog,
  NotificationType,
  User,
  UserSession,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { createId } from "../ids";
import { createUserAuthSubject } from "./auth-subject";

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

export interface SupportSessionReport {
  session: UserSessionSummary;
  status: "active" | "expired" | "revoked";
  adminUserId: string;
  targetUserId: string;
  approvalRequestId?: string;
  requestedByUserId?: string;
  ttlMinutes?: number;
  ticketRef?: string;
  reasonHash?: string;
  reasonLength?: number;
  createdAuditLogId: string;
}

export interface SupportSessionRequestReport {
  id: string;
  status: "pending" | "approved" | "rejected";
  requestedByUserId: string;
  targetUserId: string;
  ttlMinutes: number;
  createdAt: string;
  approvedAt?: string;
  approvedByUserId?: string;
  rejectedAt?: string;
  rejectedByUserId?: string;
  sessionId?: string;
  ticketRef?: string;
  reasonHash?: string;
  reasonLength?: number;
}

const sessionTokenPattern = /^rms_[a-f0-9]{48}$/;
const supportSessionScopes: Scope[] = [
  "me:read",
  "organizations:read",
  "workspaces:read",
  "providers:read",
  "models:read",
  "agents:read",
  "chats:read",
  "runs:read",
  "knowledge:read",
  "knowledge:query",
  "usage:read",
];
type SupportNotificationType = Extract<
  NotificationType,
  `support_impersonation_${string}`
>;
type SupportNotificationResourceType =
  | "support_impersonation_request"
  | "support_impersonation_session";

export class SessionService {
  constructor(private readonly repository: RomeoRepository) {}

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
    return sessions.map(toSummary);
  }

  async listSupportSessions(
    subject: AuthSubject,
  ): Promise<SupportSessionReport[]> {
    assertScope(subject, "admin:read");
    const logs = await this.repository.listAuditLogs(subject.orgId);
    const reports: SupportSessionReport[] = [];
    for (const log of logs) {
      if (
        log.action !== "support.impersonation.create" ||
        log.resourceType !== "session"
      )
        continue;
      const session = await this.repository.getUserSession(log.resourceId);
      if (!session || session.orgId !== subject.orgId) continue;
      reports.push(toSupportSessionReport(session, log));
    }
    return reports;
  }

  async listSupportSessionRequests(
    subject: AuthSubject,
  ): Promise<SupportSessionRequestReport[]> {
    assertScope(subject, "admin:read");
    return supportRequestReports(
      await this.repository.listAuditLogs(subject.orgId),
    );
  }

  async revokeSupportSession(input: {
    subject: AuthSubject;
    sessionId: string;
  }): Promise<SupportSessionReport> {
    assertScope(input.subject, "admin:write");
    assertTrueAdminUser(input.subject);
    const existing = await this.getSupportSessionReport(
      input.subject,
      input.sessionId,
    );
    if (existing.session.revokedAt !== undefined) return existing;
    const session = await this.repository.getUserSession(input.sessionId);
    if (!session || session.orgId !== input.subject.orgId)
      throw new ApiError(
        "support_impersonation_session_not_found",
        "Support session was not found.",
        404,
      );
    const revokedAt = new Date().toISOString();
    const metadata = {
      targetUserId: existing.targetUserId,
      adminUserId: existing.adminUserId,
      createdAuditLogId: existing.createdAuditLogId,
      previousStatus: existing.status,
      ...(existing.approvalRequestId === undefined
        ? {}
        : { approvalRequestId: existing.approvalRequestId }),
      ...(existing.requestedByUserId === undefined
        ? {}
        : { requestedByUserId: existing.requestedByUserId }),
      ...(existing.ticketRef === undefined
        ? {}
        : { ticketRef: existing.ticketRef }),
    };
    await this.repository.transaction(async (repository) => {
      await repository.updateUserSession({ ...session, revokedAt });
      await this.audit(
        input.subject,
        "support.impersonation.revoke",
        session.id,
        metadata,
        { repository, createdAt: revokedAt },
      );
      await this.createSupportNotification(repository, {
        orgId: input.subject.orgId,
        userId: existing.targetUserId,
        actorId: input.subject.id,
        type: "support_impersonation_session_revoked",
        resourceType: "support_impersonation_session",
        resourceId: session.id,
        metadata: {
          sessionId: session.id,
          ...metadata,
        },
        createdAt: revokedAt,
      });
      if (
        existing.requestedByUserId !== undefined &&
        existing.requestedByUserId !== existing.targetUserId
      ) {
        await this.createSupportNotification(repository, {
          orgId: input.subject.orgId,
          userId: existing.requestedByUserId,
          actorId: input.subject.id,
          type: "support_impersonation_session_revoked",
          resourceType: "support_impersonation_session",
          resourceId: session.id,
          metadata: {
            sessionId: session.id,
            ...metadata,
          },
          createdAt: revokedAt,
        });
      }
    });
    return this.getSupportSessionReport(input.subject, input.sessionId);
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
    return { session: toSummary(created), token };
  }

  async createSupportSession(input: {
    subject: AuthSubject;
    targetUserId: string;
    confirmTargetUserId: string;
    reason: string;
    ticketRef?: string;
    ttlMinutes?: number;
  }): Promise<CreatedUserSession> {
    assertScope(input.subject, "admin:write");
    assertTrueAdminUser(input.subject);
    const prepared = await this.prepareSupportSession(input);
    return this.repository.transaction((repository) => {
      return this.createSupportSessionForTarget(
        {
          actor: input.subject,
          target: prepared.target,
          ttlMinutes: prepared.ttlMinutes,
          reasonHash: prepared.reasonHash,
          reasonLength: prepared.reasonLength,
          ...(input.ticketRef === undefined
            ? {}
            : { ticketRef: input.ticketRef }),
        },
        repository,
      );
    });
  }

  async requestSupportSession(input: {
    subject: AuthSubject;
    targetUserId: string;
    confirmTargetUserId: string;
    reason: string;
    ticketRef?: string;
    ttlMinutes?: number;
  }): Promise<SupportSessionRequestReport> {
    assertScope(input.subject, "admin:read");
    if (
      input.subject.type !== "user" ||
      input.subject.supportSession !== undefined
    ) {
      throw new AuthorizationError(
        "Support access requests require an authenticated user subject.",
      );
    }
    const prepared = await this.prepareSupportSession(input);
    const requestId = createId("support_request");
    const createdAt = new Date().toISOString();
    const metadata = {
      targetUserId: prepared.target.id,
      ttlMinutes: prepared.ttlMinutes,
      scopeCount: supportSessionScopes.length,
      reasonHash: prepared.reasonHash,
      reasonLength: prepared.reasonLength,
      ...(input.ticketRef === undefined ? {} : { ticketRef: input.ticketRef }),
    };
    await this.repository.transaction(async (repository) => {
      await this.audit(
        input.subject,
        "support.impersonation.request.create",
        requestId,
        metadata,
        {
          repository,
          resourceType: "support_impersonation_request",
          createdAt,
        },
      );
      await this.createSupportNotification(repository, {
        orgId: input.subject.orgId,
        userId: prepared.target.id,
        actorId: input.subject.id,
        type: "support_impersonation_request_created",
        resourceType: "support_impersonation_request",
        resourceId: requestId,
        metadata: {
          approvalRequestId: requestId,
          requestedByUserId: input.subject.id,
          targetUserId: prepared.target.id,
          ttlMinutes: prepared.ttlMinutes,
          scopeCount: supportSessionScopes.length,
          ...(input.ticketRef === undefined
            ? {}
            : { ticketRef: input.ticketRef }),
        },
        createdAt,
      });
    });
    return this.getSupportSessionRequest(input.subject, requestId);
  }

  async approveSupportSessionRequest(input: {
    subject: AuthSubject;
    requestId: string;
  }): Promise<CreatedUserSession> {
    assertScope(input.subject, "admin:write");
    assertTrueAdminUser(input.subject);
    const request = await this.getPendingSupportSessionRequest(
      input.subject,
      input.requestId,
    );
    if (request.requestedByUserId === input.subject.id) {
      throw new ApiError(
        "support_impersonation_self_approval_forbidden",
        "Support access requests require a different approving admin.",
        403,
      );
    }
    const requester = await this.repository.getCurrentUser(
      request.requestedByUserId,
    );
    if (
      !requester ||
      requester.orgId !== input.subject.orgId ||
      requester.disabledAt !== undefined
    ) {
      throw new ApiError(
        "support_impersonation_requester_disabled",
        "Support access requests from disabled users cannot be approved.",
        409,
      );
    }
    const target = await this.repository.getCurrentUser(request.targetUserId);
    if (!target || target.orgId !== input.subject.orgId)
      throw new AuthorizationError(
        "Target user was not found in the caller organization.",
      );
    if (target.disabledAt !== undefined)
      throw new ApiError(
        "support_impersonation_target_disabled",
        "Support sessions cannot target disabled users.",
        409,
      );
    const created = await this.repository.transaction(async (repository) => {
      const created = await this.createSupportSessionForTarget(
        {
          actor: input.subject,
          target,
          ttlMinutes: request.ttlMinutes,
          reasonHash: request.reasonHash ?? "",
          reasonLength: request.reasonLength ?? 0,
          approvalRequestId: request.id,
          requestedByUserId: request.requestedByUserId,
          ...(request.ticketRef === undefined
            ? {}
            : { ticketRef: request.ticketRef }),
        },
        repository,
      );
      const approvedAt = new Date().toISOString();
      const metadata = {
        approvalRequestId: request.id,
        requestedByUserId: request.requestedByUserId,
        targetUserId: request.targetUserId,
        ttlMinutes: request.ttlMinutes,
        sessionId: created.session.id,
        ...(request.ticketRef === undefined
          ? {}
          : { ticketRef: request.ticketRef }),
      };
      await this.audit(
        input.subject,
        "support.impersonation.request.approve",
        created.session.id,
        metadata,
        { repository, createdAt: approvedAt },
      );
      await this.createSupportNotification(repository, {
        orgId: input.subject.orgId,
        userId: request.requestedByUserId,
        actorId: input.subject.id,
        type: "support_impersonation_request_approved",
        resourceType: "support_impersonation_request",
        resourceId: request.id,
        metadata,
        createdAt: approvedAt,
      });
      return created;
    });
    return created;
  }

  async rejectSupportSessionRequest(input: {
    subject: AuthSubject;
    requestId: string;
  }): Promise<SupportSessionRequestReport> {
    assertScope(input.subject, "admin:write");
    assertTrueAdminUser(input.subject);
    const request = await this.getPendingSupportSessionRequest(
      input.subject,
      input.requestId,
    );
    if (request.requestedByUserId === input.subject.id) {
      throw new ApiError(
        "support_impersonation_self_approval_forbidden",
        "Support access requests require a different deciding admin.",
        403,
      );
    }
    const rejectedAt = new Date().toISOString();
    const metadata = {
      approvalRequestId: request.id,
      requestedByUserId: request.requestedByUserId,
      targetUserId: request.targetUserId,
      ttlMinutes: request.ttlMinutes,
      ...(request.ticketRef === undefined
        ? {}
        : { ticketRef: request.ticketRef }),
    };
    await this.repository.transaction(async (repository) => {
      await this.audit(
        input.subject,
        "support.impersonation.request.reject",
        request.id,
        metadata,
        {
          repository,
          resourceType: "support_impersonation_request",
          createdAt: rejectedAt,
        },
      );
      await this.createSupportNotification(repository, {
        orgId: input.subject.orgId,
        userId: request.requestedByUserId,
        actorId: input.subject.id,
        type: "support_impersonation_request_rejected",
        resourceType: "support_impersonation_request",
        resourceId: request.id,
        metadata,
        createdAt: rejectedAt,
      });
    });
    return this.getSupportSessionRequest(input.subject, input.requestId);
  }

  private async prepareSupportSession(input: {
    subject: AuthSubject;
    targetUserId: string;
    confirmTargetUserId: string;
    reason: string;
    ttlMinutes?: number;
  }): Promise<{
    target: User;
    ttlMinutes: number;
    reasonHash: string;
    reasonLength: number;
  }> {
    if (input.targetUserId !== input.confirmTargetUserId)
      throw new ApiError(
        "target_user_confirmation_mismatch",
        "Target user confirmation does not match.",
        400,
      );
    if (input.targetUserId === input.subject.id)
      throw new ApiError(
        "support_impersonation_self_forbidden",
        "Support impersonation cannot target the current admin.",
        400,
      );
    const ttlMinutes = input.ttlMinutes ?? 15;
    if (!Number.isInteger(ttlMinutes) || ttlMinutes < 5 || ttlMinutes > 60) {
      throw new ApiError(
        "invalid_support_session_ttl",
        "Support session TTL must be between 5 and 60 minutes.",
        400,
      );
    }
    const reason = input.reason.trim();
    if (reason.length < 10 || reason.length > 500)
      throw new ApiError(
        "invalid_support_reason",
        "Support session reason must be between 10 and 500 characters.",
        400,
      );

    const target = await this.repository.getCurrentUser(input.targetUserId);
    if (!target || target.orgId !== input.subject.orgId)
      throw new AuthorizationError(
        "Target user was not found in the caller organization.",
      );
    if (target.disabledAt !== undefined)
      throw new ApiError(
        "support_impersonation_target_disabled",
        "Support sessions cannot target disabled users.",
        409,
      );
    return {
      target,
      ttlMinutes,
      reasonHash: sha256(reason),
      reasonLength: reason.length,
    };
  }

  private async createSupportSessionForTarget(
    input: {
      actor: AuthSubject;
      target: User;
      ttlMinutes: number;
      reasonHash: string;
      reasonLength: number;
      ticketRef?: string;
      approvalRequestId?: string;
      requestedByUserId?: string;
    },
    repository: RomeoRepository,
  ): Promise<CreatedUserSession> {
    const now = new Date();
    const token = createSessionToken();
    const createdAt = now.toISOString();
    const session = await repository.createUserSession({
      id: createId("session"),
      orgId: input.actor.orgId,
      userId: input.target.id,
      name: `Support session (${input.actor.id})`,
      hashedToken: await hashApiKey(token),
      scopes: supportSessionScopes,
      isAdmin: false,
      expiresAt: new Date(
        now.getTime() + input.ttlMinutes * 60 * 1000,
      ).toISOString(),
      createdAt,
    });

    const auditMetadata = {
      targetUserId: input.target.id,
      ttlMinutes: input.ttlMinutes,
      scopeCount: supportSessionScopes.length,
      reasonHash: input.reasonHash,
      reasonLength: input.reasonLength,
      ...(input.approvalRequestId === undefined
        ? {}
        : { approvalRequestId: input.approvalRequestId }),
      ...(input.requestedByUserId === undefined
        ? {}
        : { requestedByUserId: input.requestedByUserId }),
      ...(input.ticketRef === undefined ? {} : { ticketRef: input.ticketRef }),
    };
    await this.audit(
      input.actor,
      "support.impersonation.create",
      session.id,
      auditMetadata,
      { repository, createdAt },
    );
    await this.createSupportNotification(repository, {
      orgId: input.actor.orgId,
      userId: input.target.id,
      actorId: input.actor.id,
      type: "support_impersonation_session_created",
      resourceType: "support_impersonation_session",
      resourceId: session.id,
      metadata: {
        sessionId: session.id,
        targetUserId: input.target.id,
        adminUserId: input.actor.id,
        ttlMinutes: input.ttlMinutes,
        scopeCount: supportSessionScopes.length,
        ...(input.approvalRequestId === undefined
          ? {}
          : { approvalRequestId: input.approvalRequestId }),
        ...(input.requestedByUserId === undefined
          ? {}
          : { requestedByUserId: input.requestedByUserId }),
        ...(input.ticketRef === undefined
          ? {}
          : { ticketRef: input.ticketRef }),
      },
      createdAt,
    });
    return { session: toSummary(session), token };
  }

  private async getSupportSessionRequest(
    subject: AuthSubject,
    requestId: string,
  ): Promise<SupportSessionRequestReport> {
    const request = supportRequestReports(
      await this.repository.listAuditLogs(subject.orgId),
    ).find((item) => item.id === requestId);
    if (request === undefined)
      throw new ApiError(
        "support_impersonation_request_not_found",
        "Support access request was not found.",
        404,
      );
    return request;
  }

  private async getSupportSessionReport(
    subject: AuthSubject,
    sessionId: string,
  ): Promise<SupportSessionReport> {
    const report = (await this.listSupportSessions(subject)).find(
      (item) => item.session.id === sessionId,
    );
    if (report === undefined)
      throw new ApiError(
        "support_impersonation_session_not_found",
        "Support session was not found.",
        404,
      );
    return report;
  }

  private async getPendingSupportSessionRequest(
    subject: AuthSubject,
    requestId: string,
  ): Promise<SupportSessionRequestReport> {
    const request = await this.getSupportSessionRequest(subject, requestId);
    if (request.status !== "pending") {
      throw new ApiError(
        "support_impersonation_request_not_pending",
        "Support access request is no longer pending.",
        409,
        { status: request.status },
      );
    }
    return request;
  }

  async authenticate(token: string): Promise<AuthSubject> {
    if (!sessionTokenPattern.test(token))
      throw new AuthorizationError("Session token is invalid or revoked.");
    const session = await this.repository.getUserSessionByHash(
      await hashApiKey(token),
    );
    if (!session || session.revokedAt !== undefined)
      throw new AuthorizationError("Session token is invalid or revoked.");
    if (new Date(session.expiresAt).getTime() <= Date.now())
      throw new AuthorizationError("Session token is expired.");
    const user = await this.repository.getCurrentUser(session.userId);
    if (!user || user.orgId !== session.orgId)
      throw new AuthorizationError("Session owner was not found.");
    if (user.disabledAt !== undefined)
      throw new AuthorizationError("Session owner is disabled.");

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
    await this.repository.createAuditLog({
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
    return toSummary(revoked);
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
    if (session.revokedAt !== undefined) return toSummary(session);
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
    return toSummary(revoked);
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
        updatedSessions.push(toSummary(updated));
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

  private async audit(
    subject: AuthSubject,
    action: string,
    resourceId: string,
    metadata: Record<string, unknown>,
    options: {
      repository?: RomeoRepository;
      resourceType?: string;
      createdAt?: string;
    } = {},
  ): Promise<void> {
    await (options.repository ?? this.repository).createAuditLog({
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

  private async createSupportNotification(
    repository: RomeoRepository,
    input: {
      orgId: string;
      userId: string;
      actorId: string;
      type: SupportNotificationType;
      resourceType: SupportNotificationResourceType;
      resourceId: string;
      metadata: Record<string, unknown>;
      createdAt: string;
    },
  ): Promise<void> {
    await repository.createUserNotification({
      id: createId("notification"),
      orgId: input.orgId,
      userId: input.userId,
      type: input.type,
      actorId: input.actorId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      metadata: input.metadata,
      createdAt: input.createdAt,
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

function toSummary(session: UserSession): UserSessionSummary {
  const { hashedToken: _hashedToken, ...summary } = session;
  return summary;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function toSupportSessionReport(
  session: UserSession,
  log: AuditLog,
): SupportSessionReport {
  const metadata = log.metadata;
  const ttlMinutes =
    typeof metadata.ttlMinutes === "number" ? metadata.ttlMinutes : undefined;
  const ticketRef =
    typeof metadata.ticketRef === "string" ? metadata.ticketRef : undefined;
  const reasonHash =
    typeof metadata.reasonHash === "string" ? metadata.reasonHash : undefined;
  const reasonLength =
    typeof metadata.reasonLength === "number"
      ? metadata.reasonLength
      : undefined;
  const approvalRequestId =
    typeof metadata.approvalRequestId === "string"
      ? metadata.approvalRequestId
      : undefined;
  const requestedByUserId =
    typeof metadata.requestedByUserId === "string"
      ? metadata.requestedByUserId
      : undefined;
  return {
    session: toSummary(session),
    status: supportSessionStatus(session),
    adminUserId: log.actorId,
    targetUserId:
      typeof metadata.targetUserId === "string"
        ? metadata.targetUserId
        : session.userId,
    ...(approvalRequestId === undefined ? {} : { approvalRequestId }),
    ...(requestedByUserId === undefined ? {} : { requestedByUserId }),
    ...(ttlMinutes === undefined ? {} : { ttlMinutes }),
    ...(ticketRef === undefined ? {} : { ticketRef }),
    ...(reasonHash === undefined ? {} : { reasonHash }),
    ...(reasonLength === undefined ? {} : { reasonLength }),
    createdAuditLogId: log.id,
  };
}

function supportSessionStatus(
  session: UserSession,
): SupportSessionReport["status"] {
  if (session.revokedAt !== undefined) return "revoked";
  if (new Date(session.expiresAt).getTime() <= Date.now()) return "expired";
  return "active";
}

function sameScopes(left: Scope[], right: Scope[]): boolean {
  if (left.length !== right.length) return false;
  const rightScopes = new Set(right);
  return left.every((scope) => rightScopes.has(scope));
}

function assertTrueAdminUser(subject: AuthSubject): void {
  if (
    subject.type !== "user" ||
    subject.isAdmin !== true ||
    subject.supportSession !== undefined
  ) {
    throw new AuthorizationError(
      "Support impersonation requires a true admin user subject.",
    );
  }
}

function supportRequestReports(
  logs: AuditLog[],
): SupportSessionRequestReport[] {
  const decisions = logs.filter(
    (log) =>
      log.action === "support.impersonation.request.approve" ||
      log.action === "support.impersonation.request.reject",
  );
  return logs
    .filter(
      (log) =>
        log.action === "support.impersonation.request.create" &&
        log.resourceType === "support_impersonation_request",
    )
    .map((log) => supportRequestReport(log, decisions));
}

function supportRequestReport(
  log: AuditLog,
  decisions: AuditLog[],
): SupportSessionRequestReport {
  const metadata = log.metadata;
  const requestId = log.resourceId;
  const targetUserId =
    typeof metadata.targetUserId === "string" ? metadata.targetUserId : "";
  const ttlMinutes =
    typeof metadata.ttlMinutes === "number" ? metadata.ttlMinutes : 15;
  const ticketRef =
    typeof metadata.ticketRef === "string" ? metadata.ticketRef : undefined;
  const reasonHash =
    typeof metadata.reasonHash === "string" ? metadata.reasonHash : undefined;
  const reasonLength =
    typeof metadata.reasonLength === "number"
      ? metadata.reasonLength
      : undefined;
  const decision = decisions.find(
    (item) => item.metadata.approvalRequestId === requestId,
  );
  const base = {
    id: requestId,
    requestedByUserId: log.actorId,
    targetUserId,
    ttlMinutes,
    createdAt: log.createdAt,
    ...(ticketRef === undefined ? {} : { ticketRef }),
    ...(reasonHash === undefined ? {} : { reasonHash }),
    ...(reasonLength === undefined ? {} : { reasonLength }),
  };
  if (decision?.action === "support.impersonation.request.approve") {
    return {
      ...base,
      status: "approved",
      approvedAt: decision.createdAt,
      approvedByUserId: decision.actorId,
      sessionId: decision.resourceId,
    };
  }
  if (decision?.action === "support.impersonation.request.reject") {
    return {
      ...base,
      status: "rejected",
      rejectedAt: decision.createdAt,
      rejectedByUserId: decision.actorId,
    };
  }
  return { ...base, status: "pending" };
}

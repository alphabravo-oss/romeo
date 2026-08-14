import { AuthorizationError, assertScope, type AuthSubject } from "@romeo/auth";

import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { createId } from "../ids";
import {
  assertTrueAdminUser,
  supportRequestReports,
  toSupportSessionReport,
} from "./support-session-reporting";
import {
  createSupportSessionForTarget,
  prepareSupportSession,
  supportSessionScopes,
} from "./support-session-infrastructure";
import type {
  SupportNotificationResourceType,
  SupportNotificationType,
  SupportSessionReport,
  SupportSessionRequestReport,
} from "./support-session-types";
import type { CreatedUserSession } from "./session-service";

export class SupportSessionService {
  constructor(private readonly repository: RomeoRepository) {}

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
    const prepared = await prepareSupportSession(this.repository, input);
    return this.repository.transaction((repository) => {
      return createSupportSessionForTarget(
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
    const prepared = await prepareSupportSession(this.repository, input);
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
      const created = await createSupportSessionForTarget(
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
}
import {
  type AuditAction,
  type AuditMetadata,
  writeAuditLog,
} from "./audit-log";

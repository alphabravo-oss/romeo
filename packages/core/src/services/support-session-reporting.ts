import { AuthorizationError, type AuthSubject, type Scope } from "@romeo/auth";

import type { AuditLog, UserSession } from "../domain/entities";
import { toSessionSummary } from "./session-summary";
import type {
  SupportSessionReport,
  SupportSessionRequestReport,
} from "./support-session-types";

export function toSupportSessionReport(
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
    session: toSessionSummary(session),
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

export function sameScopes(left: Scope[], right: Scope[]): boolean {
  if (left.length !== right.length) return false;
  const rightScopes = new Set(right);
  return left.every((scope) => rightScopes.has(scope));
}

export function assertTrueAdminUser(subject: AuthSubject): void {
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

export function supportRequestReports(
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

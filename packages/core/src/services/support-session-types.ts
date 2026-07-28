import type { NotificationType } from "../domain/entities";
import type { UserSessionSummary } from "./session-service";

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

export type SupportNotificationType = Extract<
  NotificationType,
  `support_impersonation_${string}`
>;
export type SupportNotificationResourceType =
  | "support_impersonation_request"
  | "support_impersonation_session";

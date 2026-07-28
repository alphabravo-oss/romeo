import { createHash } from "node:crypto";
import {
  AuthorizationError,
  createSessionToken,
  hashApiKey,
  type AuthSubject,
  type Scope,
} from "@romeo/auth";

import type { User } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { createId } from "../ids";
import { toSessionSummary } from "./session-summary";
import type { CreatedUserSession } from "./session-service";
import type {
  SupportNotificationResourceType,
  SupportNotificationType,
} from "./support-session-types";

export const supportSessionScopes: Scope[] = [
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

export async function prepareSupportSession(
  repository: RomeoRepository,
  input: {
    subject: AuthSubject;
    targetUserId: string;
    confirmTargetUserId: string;
    reason: string;
    ttlMinutes?: number;
  },
): Promise<{
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

  const target = await repository.getCurrentUser(input.targetUserId);
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

export async function createSupportSessionForTarget(
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
  await writeSupportSessionAudit(
    repository,
    input.actor,
    "support.impersonation.create",
    session.id,
    auditMetadata,
    { createdAt },
  );
  await createSupportNotification(repository, {
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
      ...(input.ticketRef === undefined ? {} : { ticketRef: input.ticketRef }),
    },
    createdAt,
  });
  return { session: toSessionSummary(session), token };
}

export async function writeSupportSessionAudit(
  repository: RomeoRepository,
  subject: AuthSubject,
  action: string,
  resourceId: string,
  metadata: Record<string, unknown>,
  options: {
    resourceType?: string;
    createdAt?: string;
  } = {},
): Promise<void> {
  await repository.createAuditLog({
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

export async function createSupportNotification(
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

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

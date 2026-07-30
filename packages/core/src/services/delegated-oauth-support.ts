import { createHash, randomBytes } from "node:crypto";
import type { AuthSubject } from "@romeo/auth";

import type { DataConnectorType } from "../domain/data-connectors";
import type { DelegatedOAuthConnection } from "../domain/delegated-oauth";
import type { BackgroundJob } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { createId } from "../ids";
import type { DelegatedOAuthState } from "./delegated-oauth-internal-types";
import type { DelegatedOAuthStoredToken } from "./delegated-oauth-token-vault";
import { normalizeAppOrigin, sanitizeAuthReturnTo } from "./auth-navigation";

export { normalizeAppOrigin };

const callbackStateJobType = "delegated_oauth.callback_state";

export async function auditDelegatedOAuth(
  repository: RomeoRepository,
  subject: AuthSubject,
  action: string,
  resourceId: string,
  outcome: "success" | "failure",
  metadata: Record<string, unknown>,
): Promise<void> {
  await repository.createAuditLog({
    id: createId("audit"),
    orgId: subject.orgId,
    actorId: subject.id,
    action,
    resourceType: "data_connector",
    resourceId,
    outcome,
    metadata,
    createdAt: new Date().toISOString(),
  });
}

export function stateSubject(state: DelegatedOAuthState): AuthSubject {
  return {
    id: state.userId,
    type: "user",
    orgId: state.orgId,
    workspaceIds: [state.workspaceId],
    groupIds: [],
    scopes: [],
  };
}

export function stateSubjectFromConnection(
  connection: DelegatedOAuthConnection,
): AuthSubject {
  return {
    id: connection.userId,
    type: "user",
    orgId: connection.orgId,
    workspaceIds: [connection.workspaceId],
    groupIds: [],
    scopes: [],
  };
}

export function isExpiredOrNearExpiry(
  token: DelegatedOAuthStoredToken,
): boolean {
  if (token.expiresAt === undefined) return false;
  return new Date(token.expiresAt).getTime() <= Date.now() + 60_000;
}

export function sanitizeReturnTo(value: string | undefined): string {
  return sanitizeAuthReturnTo(value, {
    errorCode: "invalid_delegated_oauth_return_to",
    flowName: "Delegated OAuth",
  });
}

export function randomToken(byteLength: number): string {
  return randomBytes(byteLength).toString("base64url");
}

export function codeChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url");
}

export function csv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function base64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

export function parseJsonState(payload: string): unknown {
  try {
    return JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as unknown;
  } catch {
    throw new ApiError(
      "delegated_oauth_state_invalid",
      "Delegated OAuth state is invalid.",
      400,
    );
  }
}

export function isDelegatedOAuthState(
  value: unknown,
): value is DelegatedOAuthState {
  const candidate = value as Partial<DelegatedOAuthState>;
  return (
    typeof value === "object" &&
    value !== null &&
    candidate.v === 1 &&
    typeof candidate.state === "string" &&
    typeof candidate.codeVerifier === "string" &&
    typeof candidate.nonce === "string" &&
    typeof candidate.orgId === "string" &&
    typeof candidate.userId === "string" &&
    typeof candidate.workspaceId === "string" &&
    candidate.providerId === "github" &&
    isConnectorType(candidate.connectorType) &&
    typeof candidate.redirectUri === "string" &&
    typeof candidate.returnTo === "string" &&
    Array.isArray(candidate.scopes) &&
    candidate.scopes.every((scope) => typeof scope === "string") &&
    typeof candidate.expiresAt === "string"
  );
}

export function callbackStateJob(
  state: DelegatedOAuthState,
  now: string,
): BackgroundJob {
  const stateHash = callbackStateHash(state);
  return {
    id: `delegated_oauth_state_${stateHash}`,
    orgId: state.orgId,
    workspaceId: state.workspaceId,
    type: callbackStateJobType,
    status: "completed",
    payload: {
      connectorType: state.connectorType,
      expiresAt: state.expiresAt,
      providerId: state.providerId,
      purpose: "delegated_oauth_callback_replay_guard",
      stateHash,
      userId: state.userId,
      workspaceId: state.workspaceId,
    },
    createdAt: now,
    updatedAt: now,
    completedAt: now,
  };
}

function callbackStateHash(state: DelegatedOAuthState): string {
  return createHash("sha256")
    .update(
      [
        state.orgId,
        state.userId,
        state.workspaceId,
        state.providerId,
        state.connectorType,
        state.state,
        state.nonce,
      ].join("\0"),
    )
    .digest("hex");
}

export function callbackStateReplayError(): ApiError {
  return new ApiError(
    "delegated_oauth_state_replayed",
    "Delegated OAuth state has already been used.",
    409,
  );
}

export function isCallbackStateReplayError(error: unknown): boolean {
  return (
    error instanceof ApiError && error.code === "delegated_oauth_state_replayed"
  );
}

export function isUniqueConstraintError(error: unknown): boolean {
  const candidate = error as { cause?: { code?: unknown }; code?: unknown };
  return candidate.code === "23505" || candidate.cause?.code === "23505";
}

export function apiErrorCode(error: unknown): string {
  if (error instanceof ApiError) return error.code;
  return "delegated_oauth_provider_revoke_failed";
}

export function isConnectorType(value: unknown): value is DataConnectorType {
  return (
    value === "github" ||
    value === "local_import" ||
    value === "rss" ||
    value === "s3" ||
    value === "website" ||
    value === "confluence" ||
    value === "jira" ||
    value === "notion" ||
    value === "linear" ||
    value === "slack"
  );
}

export function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

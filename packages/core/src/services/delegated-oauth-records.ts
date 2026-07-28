import type {
  DelegatedOAuthConnection,
  DelegatedOAuthConnectionPostureCounts,
  DelegatedOAuthConnectionSummary,
  DelegatedOAuthConnectorTypePosture,
  DelegatedOAuthProviderPosture,
} from "../domain/delegated-oauth";
import { createId } from "../ids";
import type {
  DelegatedOAuthProviderRefreshedToken,
  DelegatedOAuthProviderToken,
} from "./delegated-oauth-github-provider";
import type { DelegatedOAuthState } from "./delegated-oauth-internal-types";
import type { DelegatedOAuthStoredToken } from "./delegated-oauth-token-vault";
import { stableHash } from "./delegated-oauth-support";

export function connectionRecord(input: {
  existing: DelegatedOAuthConnection | undefined;
  now: string;
  providerToken: DelegatedOAuthProviderToken;
  state: DelegatedOAuthState;
  token: DelegatedOAuthConnection["token"];
}): DelegatedOAuthConnection {
  const connection: DelegatedOAuthConnection = {
    id: input.existing?.id ?? createId("delegated_oauth_connection"),
    orgId: input.state.orgId,
    workspaceId: input.state.workspaceId,
    userId: input.state.userId,
    providerId: input.state.providerId,
    connectorType: input.state.connectorType,
    providerAccountId: input.providerToken.providerAccountId,
    scopes: input.providerToken.scopes,
    status: "active",
    token: input.token,
    createdAt: input.existing?.createdAt ?? input.now,
    updatedAt: input.now,
  };
  if (input.providerToken.providerAccountLogin !== undefined)
    connection.providerAccountLogin = input.providerToken.providerAccountLogin;
  if (input.providerToken.accessTokenExpiresAt !== undefined)
    connection.accessTokenExpiresAt = input.providerToken.accessTokenExpiresAt;
  if (input.providerToken.refreshTokenExpiresAt !== undefined) {
    connection.refreshTokenExpiresAt =
      input.providerToken.refreshTokenExpiresAt;
  }
  if (input.existing?.lastUsedAt !== undefined)
    connection.lastUsedAt = input.existing.lastUsedAt;
  return connection;
}

export function storedToken(
  providerToken: DelegatedOAuthProviderToken,
  obtainedAt: string,
): DelegatedOAuthStoredToken {
  const token: DelegatedOAuthStoredToken = {
    accessToken: providerToken.accessToken,
    tokenType: providerToken.tokenType,
    obtainedAt,
    scopes: providerToken.scopes,
  };
  if (providerToken.refreshToken !== undefined)
    token.refreshToken = providerToken.refreshToken;
  if (providerToken.accessTokenExpiresAt !== undefined)
    token.expiresAt = providerToken.accessTokenExpiresAt;
  if (providerToken.refreshTokenExpiresAt !== undefined)
    token.refreshTokenExpiresAt = providerToken.refreshTokenExpiresAt;
  return token;
}

export function refreshedStoredToken(
  refreshed: DelegatedOAuthProviderRefreshedToken,
  previous: DelegatedOAuthStoredToken,
  obtainedAt: string,
): DelegatedOAuthStoredToken {
  const token: DelegatedOAuthStoredToken = {
    accessToken: refreshed.accessToken,
    tokenType: refreshed.tokenType,
    obtainedAt,
    scopes: refreshed.scopes,
  };
  const refreshToken = refreshed.refreshToken ?? previous.refreshToken;
  if (refreshToken !== undefined) token.refreshToken = refreshToken;
  if (refreshed.accessTokenExpiresAt !== undefined)
    token.expiresAt = refreshed.accessTokenExpiresAt;
  const refreshTokenExpiresAt =
    refreshed.refreshTokenExpiresAt ?? previous.refreshTokenExpiresAt;
  if (refreshTokenExpiresAt !== undefined)
    token.refreshTokenExpiresAt = refreshTokenExpiresAt;
  return token;
}

export function refreshedConnectionRecord(input: {
  connection: DelegatedOAuthConnection;
  now: string;
  refreshed: DelegatedOAuthProviderRefreshedToken;
  token: DelegatedOAuthConnection["token"];
}): DelegatedOAuthConnection {
  const connection: DelegatedOAuthConnection = {
    ...input.connection,
    scopes: input.refreshed.scopes,
    status: "active",
    token: input.token,
    lastUsedAt: input.now,
    updatedAt: input.now,
  };
  if (input.refreshed.accessTokenExpiresAt !== undefined)
    connection.accessTokenExpiresAt = input.refreshed.accessTokenExpiresAt;
  if (input.refreshed.refreshTokenExpiresAt !== undefined) {
    connection.refreshTokenExpiresAt = input.refreshed.refreshTokenExpiresAt;
  }
  return connection;
}

export function toConnectionSummary(
  connection: DelegatedOAuthConnection,
): DelegatedOAuthConnectionSummary {
  const summary: DelegatedOAuthConnectionSummary = {
    id: connection.id,
    workspaceId: connection.workspaceId,
    userId: connection.userId,
    providerId: connection.providerId,
    connectorType: connection.connectorType,
    providerAccountHash: stableHash(connection.providerAccountId),
    providerAccountLoginConfigured:
      connection.providerAccountLogin !== undefined,
    scopes: connection.scopes,
    status: connection.status,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
  if (connection.providerAccountLogin !== undefined)
    summary.providerAccountLoginHash = stableHash(
      connection.providerAccountLogin,
    );
  if (connection.accessTokenExpiresAt !== undefined)
    summary.accessTokenExpiresAt = connection.accessTokenExpiresAt;
  if (connection.refreshTokenExpiresAt !== undefined)
    summary.refreshTokenExpiresAt = connection.refreshTokenExpiresAt;
  if (connection.lastUsedAt !== undefined)
    summary.lastUsedAt = connection.lastUsedAt;
  if (connection.revokedAt !== undefined)
    summary.revokedAt = connection.revokedAt;
  return summary;
}

export function delegatedOAuthConnectionPostureCounts(
  connections: DelegatedOAuthConnection[],
  nowMs: number,
): DelegatedOAuthConnectionPostureCounts {
  const nearExpiryMs = 24 * 60 * 60 * 1000;
  const counts: DelegatedOAuthConnectionPostureCounts = {
    active: 0,
    expiredAccessToken: 0,
    expiringAccessToken: 0,
    reauthorizationRequired: 0,
    revoked: 0,
    total: connections.length,
    unused: 0,
  };
  for (const connection of connections) {
    if (connection.status === "active") {
      counts.active += 1;
      if (connection.lastUsedAt === undefined) counts.unused += 1;
      const expiresAtMs =
        connection.accessTokenExpiresAt === undefined
          ? Number.NaN
          : new Date(connection.accessTokenExpiresAt).getTime();
      if (Number.isFinite(expiresAtMs)) {
        if (expiresAtMs <= nowMs) counts.expiredAccessToken += 1;
        else if (expiresAtMs <= nowMs + nearExpiryMs) {
          counts.expiringAccessToken += 1;
        }
      }
    } else if (connection.status === "reauthorization_required") {
      counts.reauthorizationRequired += 1;
    } else if (connection.status === "revoked") {
      counts.revoked += 1;
    }
  }
  return counts;
}

export function addConnectionPostureWarnings(
  warnings: Set<string>,
  scope: string,
  counts: DelegatedOAuthConnectionPostureCounts,
): void {
  if (counts.expiredAccessToken > 0) {
    warnings.add(`delegated_oauth_access_token_expired:${scope}`);
  }
  if (counts.expiringAccessToken > 0) {
    warnings.add(`delegated_oauth_access_token_expiring:${scope}`);
  }
  if (counts.reauthorizationRequired > 0) {
    warnings.add(`delegated_oauth_reauthorization_required:${scope}`);
  }
  if (counts.revoked > 0) {
    warnings.add(`delegated_oauth_revoked_connections_present:${scope}`);
  }
}

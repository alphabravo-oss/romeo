import type { DataConnectorType } from "./data-connectors";

export type DelegatedOAuthProviderId = "github";

export interface DelegatedOAuthProvider {
  authorizationHost: string;
  configured: boolean;
  connectorTypes: DataConnectorType[];
  defaultScopes: string[];
  displayName: string;
  id: DelegatedOAuthProviderId;
  pkceRequired: boolean;
  tokenHost: string;
}

export interface DelegatedOAuthStartResult {
  authorizationUrl: string;
  connectorType: DataConnectorType;
  expiresAt: string;
  provider: DelegatedOAuthProvider;
  scopes: string[];
  stateCookie: string;
  workspaceId: string;
}

export type DelegatedOAuthConnectionStatus =
  | "active"
  | "reauthorization_required"
  | "revoked";

export type DelegatedOAuthProviderRevocationStatus =
  | "failed"
  | "skipped"
  | "succeeded";

export interface DelegatedOAuthTokenEnvelope {
  alg: "A256GCM";
  ciphertext: string;
  createdAt: string;
  iv: string;
  tag: string;
  v: 1;
}

export interface DelegatedOAuthConnection {
  id: string;
  orgId: string;
  workspaceId: string;
  userId: string;
  providerId: DelegatedOAuthProviderId;
  connectorType: DataConnectorType;
  providerAccountId: string;
  providerAccountLogin?: string;
  scopes: string[];
  status: DelegatedOAuthConnectionStatus;
  token: DelegatedOAuthTokenEnvelope;
  accessTokenExpiresAt?: string;
  refreshTokenExpiresAt?: string;
  lastUsedAt?: string;
  revokedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DelegatedOAuthConnectionSummary {
  id: string;
  workspaceId: string;
  userId: string;
  providerId: DelegatedOAuthProviderId;
  connectorType: DataConnectorType;
  providerAccountHash: string;
  providerAccountLoginConfigured: boolean;
  providerAccountLoginHash?: string;
  providerRevocationErrorCode?: string;
  providerRevocationStatus?: DelegatedOAuthProviderRevocationStatus;
  scopes: string[];
  status: DelegatedOAuthConnectionStatus;
  accessTokenExpiresAt?: string;
  refreshTokenExpiresAt?: string;
  lastUsedAt?: string;
  revokedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DelegatedOAuthCallbackResult {
  connection: DelegatedOAuthConnectionSummary;
  returnTo: string;
}

export interface DelegatedOAuthConnectionPostureCounts {
  active: number;
  expiredAccessToken: number;
  expiringAccessToken: number;
  reauthorizationRequired: number;
  revoked: number;
  total: number;
  unused: number;
}

export interface DelegatedOAuthConnectorTypePosture {
  connectorType: DataConnectorType;
  connectionCounts: DelegatedOAuthConnectionPostureCounts;
}

export interface DelegatedOAuthProviderPosture {
  authorizationHost: string;
  configured: boolean;
  connectorTypes: DataConnectorType[];
  connectionCounts: DelegatedOAuthConnectionPostureCounts;
  defaultScopeCount: number;
  displayName: string;
  id: DelegatedOAuthProviderId;
  pkceRequired: true;
  tokenHost: string;
}

export interface DelegatedOAuthPostureReport {
  connectorTypes: DelegatedOAuthConnectorTypePosture[];
  generatedAt: string;
  orgId: string;
  providers: DelegatedOAuthProviderPosture[];
  redaction: {
    rawAccessTokensReturned: false;
    rawClientSecretsReturned: false;
    rawProviderAccountIdsReturned: false;
    rawProviderAccountLoginsReturned: false;
    rawProviderUrlsReturned: false;
    rawRefreshTokensReturned: false;
  };
  schema: "romeo.delegated-oauth-posture.v1";
  status: "attention_required" | "healthy";
  warnings: string[];
}

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

export interface StartDelegatedOAuthInput {
  connectorType: DataConnectorType;
  providerId: DelegatedOAuthProviderId;
  returnTo?: string;
  scopes?: string[];
  workspaceId: string;
}

export interface DelegatedOAuthStartResult {
  authorizationUrl: string;
  connectorType: DataConnectorType;
  expiresAt: string;
  provider: DelegatedOAuthProvider;
  scopes: string[];
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

export interface DelegatedOAuthConnection {
  accessTokenExpiresAt?: string;
  connectorType: DataConnectorType;
  createdAt: string;
  id: string;
  lastUsedAt?: string;
  providerAccountHash: string;
  providerAccountLoginConfigured: boolean;
  providerAccountLoginHash?: string;
  providerId: DelegatedOAuthProviderId;
  providerRevocationErrorCode?: string;
  providerRevocationStatus?: DelegatedOAuthProviderRevocationStatus;
  refreshTokenExpiresAt?: string;
  revokedAt?: string;
  scopes: string[];
  status: DelegatedOAuthConnectionStatus;
  updatedAt: string;
  userId: string;
  workspaceId: string;
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

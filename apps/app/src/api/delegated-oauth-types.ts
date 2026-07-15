export type DataConnectorType = 'local_import' | 'github' | 's3' | 'website' | 'rss'

export interface DelegatedOAuthProvider {
  id: 'github'
  displayName: string
  authorizationHost: string
  tokenHost: string
  configured: boolean
  connectorTypes: DataConnectorType[]
  defaultScopes: string[]
  pkceRequired: boolean
}

export type DelegatedOAuthConnectionStatus = 'active' | 'reauthorization_required' | 'revoked'

export type DelegatedOAuthProviderRevocationStatus = 'failed' | 'skipped' | 'succeeded'

export interface DelegatedOAuthConnectionSummary {
  id: string
  workspaceId: string
  userId: string
  providerId: 'github'
  connectorType: DataConnectorType
  providerAccountId: string
  providerAccountLogin?: string
  providerRevocationErrorCode?: string
  providerRevocationStatus?: DelegatedOAuthProviderRevocationStatus
  scopes: string[]
  status: DelegatedOAuthConnectionStatus
  accessTokenExpiresAt?: string
  refreshTokenExpiresAt?: string
  lastUsedAt?: string
  revokedAt?: string
  createdAt: string
  updatedAt: string
}

export interface StartDelegatedOAuthInput {
  providerId: 'github'
  workspaceId: string
  connectorType: DataConnectorType
  scopes?: string[]
  returnTo?: string
}

export interface DelegatedOAuthStartResult {
  authorizationUrl: string
  connectorType: DataConnectorType
  expiresAt: string
  provider: DelegatedOAuthProvider
  scopes: string[]
  workspaceId: string
}

export interface DelegatedOAuthConnectionPostureCounts {
  active: number
  expiredAccessToken: number
  expiringAccessToken: number
  reauthorizationRequired: number
  revoked: number
  total: number
  unused: number
}

export interface DelegatedOAuthConnectorTypePosture {
  connectorType: DataConnectorType
  connectionCounts: DelegatedOAuthConnectionPostureCounts
}

export interface DelegatedOAuthProviderPosture {
  authorizationHost: string
  configured: boolean
  connectorTypes: DataConnectorType[]
  connectionCounts: DelegatedOAuthConnectionPostureCounts
  defaultScopeCount: number
  displayName: string
  id: 'github'
  pkceRequired: true
  tokenHost: string
}

export interface DelegatedOAuthPostureReport {
  connectorTypes: DelegatedOAuthConnectorTypePosture[]
  generatedAt: string
  orgId: string
  providers: DelegatedOAuthProviderPosture[]
  redaction: {
    rawAccessTokensReturned: false
    rawClientSecretsReturned: false
    rawProviderAccountIdsReturned: false
    rawProviderAccountLoginsReturned: false
    rawProviderUrlsReturned: false
    rawRefreshTokensReturned: false
  }
  schema: 'romeo.delegated-oauth-posture.v1'
  status: 'attention_required' | 'healthy'
  warnings: string[]
}

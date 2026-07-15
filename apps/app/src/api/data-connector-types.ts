export type DataConnectorType = 'local_import' | 'github' | 's3' | 'website' | 'rss'

export interface DataConnector {
  id: string
  workspaceId: string
  knowledgeBaseId: string
  type: DataConnectorType
  name: string
  status: 'active' | 'disabled'
  config: Record<string, unknown>
  syncIntervalMinutes?: number
  nextSyncAt?: string
  lastSyncAt?: string
}

export interface DataConnectorSync {
  id: string
  connectorId: string
  status: 'running' | 'completed' | 'failed'
  itemCount: number
  sourceIds: string[]
  summary: Record<string, unknown>
  errorCode?: string
  startedAt: string
  completedAt?: string
}

// ===== App-store catalog =====

export type DataConnectorImplementationStatus = 'implemented' | 'planned'
export type DataConnectorSyncMode = 'inline_items' | 'managed_fetch'
export type DataConnectorExecutionBoundary = 'api_ingest' | 'bounded_runtime_fetch'
export type DataConnectorCredentialSource =
  | 'none'
  | 'deployment_secret'
  | 'connector_secret_ref'
  | 'delegated_oauth'

export interface DataConnectorEgressPolicy {
  required: boolean
  allowlistSupported: boolean
  hostSource: 'none' | 'connector_url' | 'github_api' | 's3_endpoint'
  privateNetworkDeniedByExecutor: boolean
}

export interface DataConnectorLimitPolicy {
  maxConfigItems?: number
  maxInlineItems?: number
  maxInlineItemBytes?: number
}

/** Static per-type catalog card metadata. */
export interface DataConnectorCatalogEntry {
  type: DataConnectorType
  displayName: string
  description: string
  implementationStatus: DataConnectorImplementationStatus
  syncMode: DataConnectorSyncMode
  executionBoundary: DataConnectorExecutionBoundary
  supportsScheduledSync: boolean
  supportsDelegatedOAuth: boolean
  credentialSources: DataConnectorCredentialSource[]
  requiredConfigKeys: string[]
  optionalConfigKeys: string[]
  egress: DataConnectorEgressPolicy
  limits: DataConnectorLimitPolicy
  securityControls: string[]
}

/** Catalog entry merged with runtime posture + per-connector gating. */
export interface DataConnectorCatalogItem extends DataConnectorCatalogEntry {
  runtime: {
    syncEnabled: boolean
    blockedReasons: string[]
    warnings: string[]
    credentialPosture: Record<DataConnectorCredentialSource, boolean>
  }
}

export interface DataConnectorCatalogReport {
  executionDriver: string
  egressPolicy: string
  allowedHostRuleCount: number
  fetchLimits: {
    maxBytes: number
    retryAttempts: number
    retryBackoffMs: number
    timeoutMs: number
  }
  secretResolver: {
    driver: string
    managedSecretConfigured: boolean
    externalValueResolverConfigured: boolean
  }
  connectors: DataConnectorCatalogItem[]
}

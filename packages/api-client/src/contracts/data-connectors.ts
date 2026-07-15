export type DataConnectorType =
  | "local_import"
  | "github"
  | "s3"
  | "website"
  | "rss"
  | "confluence"
  | "jira"
  | "notion"
  | "linear"
  | "slack";
export type DataConnectorStatus = "active" | "disabled";
export type DataConnectorSyncStatus = "running" | "completed" | "failed";
export type DataConnectorCredentialSource =
  | "none"
  | "deployment_secret"
  | "connector_secret_ref"
  | "delegated_oauth";

export interface DataConnector {
  id: string;
  orgId: string;
  workspaceId: string;
  knowledgeBaseId: string;
  type: DataConnectorType;
  name: string;
  config: Record<string, unknown>;
  status: DataConnectorStatus;
  syncIntervalMinutes?: number;
  nextSyncAt?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  lastSyncAt?: string;
}

export interface DataConnectorSync {
  id: string;
  orgId: string;
  workspaceId: string;
  knowledgeBaseId: string;
  connectorId: string;
  status: DataConnectorSyncStatus;
  createdBy: string;
  itemCount: number;
  sourceIds: string[];
  summary: Record<string, unknown>;
  errorCode?: string;
  startedAt: string;
  completedAt?: string;
}

export interface DataConnectorCatalogReport {
  executionDriver:
    | "disabled"
    | "website-fetch"
    | "github-fetch"
    | "s3-fetch"
    | "atlassian-fetch"
    | "notion-fetch"
    | "linear-fetch"
    | "slack-fetch"
    | "managed-fetch";
  egressPolicy: "allow_public" | "require_allowlist";
  allowedHostRuleCount: number;
  fetchLimits: {
    maxBytes: number;
    retryAttempts: number;
    retryBackoffMs: number;
    timeoutMs: number;
  };
  secretResolver: {
    driver:
      | "disabled"
      | "env"
      | "vault"
      | "aws-sm"
      | "gcp-sm"
      | "azure-kv"
      | "cloud";
    managedSecretConfigured: boolean;
    externalValueResolverConfigured: boolean;
  };
  connectors: DataConnectorCatalogEntry[];
}

export type DataConnectorPostureWarning =
  | "data_connector_driver_disabled"
  | "data_connector_failed_syncs_present"
  | "data_connector_live_evidence_invalid"
  | "data_connector_live_evidence_required"
  | "data_connector_network_policy_not_configured"
  | "data_connector_scheduled_syncs_without_worker"
  | "data_connector_worker_not_enabled";

export interface DataConnectorPostureReport {
  schema: "romeo.data-connector-posture.v1";
  generatedAt: string;
  orgId: string;
  status: "attention_required" | "ready";
  runtime: {
    executionDriver: DataConnectorCatalogReport["executionDriver"];
    egressPolicy: DataConnectorCatalogReport["egressPolicy"];
    managedFetchEnabled: boolean;
    allowedHostRuleCount: number;
    fetchLimits: DataConnectorCatalogReport["fetchLimits"];
    secretResolver: DataConnectorCatalogReport["secretResolver"];
    credentialPosture: {
      delegatedOAuthGithubConfigured: boolean;
      githubDeploymentTokenConfigured: boolean;
      s3DeploymentCredentialsConfigured: boolean;
      s3EndpointConfigured: boolean;
    };
  };
  deployment: {
    liveEvidencePathConfigured: boolean;
    networkPolicyConfigured: boolean;
    workerEnabled: boolean;
  };
  connectors: {
    active: number;
    disabled: number;
    due: number;
    managed: number;
    scheduled: number;
    total: number;
    byType: Record<DataConnectorType, number>;
  };
  syncs: {
    completed: number;
    failed: number;
    latestCompletedAt: string | null;
    latestFailedAt: string | null;
    running: number;
    total: number;
  };
  liveEvidence: {
    configured: boolean;
    source: "configured_file" | "not_configured";
    status: "failed" | "invalid" | "not_configured" | "satisfied";
    schemaVersion?: "romeo.data-connector-live-evidence.v1";
    evidenceStatus?: "failed" | "passed" | "planned" | "unknown";
    mode?: "dry-run" | "live" | "unknown";
    deployment?: "compose" | "kubernetes" | "target" | "unknown";
    generatedAt?: string;
    checks: {
      managed_connector_sync_exercised: boolean;
      worker_cni_egress_enforced: boolean;
      dns_private_address_denied: boolean;
      secret_ref_resolution_verified: boolean;
      worker_crash_retry_or_requeue_verified: boolean;
      sync_log_redaction: boolean;
      sanitized_readback_verified: boolean;
    };
    failureCodes: string[];
    invalidReason?: "invalid_json" | "read_failed" | "schema_mismatch";
    summary: {
      delegatedOAuthConnectorCount: number;
      deniedPrivateTargetCount: number;
      failedSyncCount: number;
      managedConnectorTypeCount: number;
      podLogScanCount: number;
      requeuedSyncCount: number;
      secretRefConnectorCount: number;
      successfulSyncCount: number;
      syncAttemptCount: number;
      workerLogScanCount: number;
    };
    redaction: DataConnectorPostureRedaction;
  };
  redaction: DataConnectorPostureRedaction & {
    evidenceFileBodiesReturned: false;
  };
  warnings: DataConnectorPostureWarning[];
}

export interface DataConnectorPostureRedaction {
  rawAllowedHostsReturned: boolean;
  rawConnectorConfigReturned: boolean;
  rawConnectorContentReturned: boolean;
  rawEndpointUrlsReturned: boolean;
  rawEvidencePathsReturned: boolean;
  rawSecretRefsReturned: boolean;
  secretValuesReturned: boolean;
  tokenValuesReturned: boolean;
  rawLogLinesReturned?: boolean;
}

export interface DataConnectorCatalogEntry {
  type: DataConnectorType;
  displayName: string;
  description: string;
  implementationStatus: "implemented" | "planned";
  syncMode: "inline_items" | "managed_fetch";
  executionBoundary: "api_ingest" | "bounded_runtime_fetch";
  supportsScheduledSync: boolean;
  supportsDelegatedOAuth: boolean;
  credentialSources: DataConnectorCredentialSource[];
  requiredConfigKeys: string[];
  optionalConfigKeys: string[];
  egress: {
    required: boolean;
    allowlistSupported: boolean;
    hostSource: "none" | "connector_url" | "github_api" | "s3_endpoint";
    privateNetworkDeniedByExecutor: boolean;
  };
  limits: {
    maxConfigItems?: number;
    maxInlineItems?: number;
    maxInlineItemBytes?: number;
  };
  securityControls: string[];
  runtime: {
    syncEnabled: boolean;
    blockedReasons: string[];
    warnings: string[];
    credentialPosture: Record<DataConnectorCredentialSource, boolean>;
  };
}

export interface CreateDataConnectorInput {
  workspaceId: string;
  knowledgeBaseId: string;
  type: DataConnectorType;
  name: string;
  syncIntervalMinutes?: number;
  config?: Record<string, unknown>;
}

export interface DataConnectorSyncItem {
  fileName: string;
  mimeType: string;
  content: string;
  sizeBytes?: number;
}

export interface SyncDataConnectorInput {
  connectorId: string;
  items?: DataConnectorSyncItem[];
}

import type { RomeoEnv } from "@romeo/config";

import type {
  DataConnectorCatalogEntry,
  DataConnectorCredentialSource,
} from "../domain/data-connector-catalog";
import type { DataConnectorType } from "../domain/entities";

export interface DataConnectorCatalogRuntimePosture {
  executionDriver: RomeoEnv["DATA_CONNECTOR_EXECUTION_DRIVER"];
  egressPolicy: RomeoEnv["DATA_CONNECTOR_EGRESS_POLICY"];
  allowedHostRuleCount: number;
  fetchMaxBytes: number;
  fetchRetryAttempts: number;
  fetchRetryBackoffMs: number;
  fetchTimeoutMs: number;
  liveEvidencePath: string;
  workerEnabled: boolean;
  networkPolicyConfigured: boolean;
  secretResolverDriver: RomeoEnv["SECRET_RESOLVER_DRIVER"];
  managedSecretConfigured: boolean;
  githubDeploymentTokenConfigured: boolean;
  delegatedOAuthGithubConfigured: boolean;
  s3EndpointConfigured: boolean;
  s3DeploymentCredentialsConfigured: boolean;
}

export const dataConnectorLiveEvidenceSchema =
  "romeo.data-connector-live-evidence.v1";
export const dataConnectorRequiredLiveEvidenceChecks = [
  "managed_connector_sync_exercised",
  "worker_cni_egress_enforced",
  "dns_private_address_denied",
  "secret_ref_resolution_verified",
  "worker_crash_retry_or_requeue_verified",
  "sync_log_redaction",
  "sanitized_readback_verified",
] as const;

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
    executionDriver: RomeoEnv["DATA_CONNECTOR_EXECUTION_DRIVER"];
    egressPolicy: RomeoEnv["DATA_CONNECTOR_EGRESS_POLICY"];
    managedFetchEnabled: boolean;
    allowedHostRuleCount: number;
    fetchLimits: {
      maxBytes: number;
      retryAttempts: number;
      retryBackoffMs: number;
      timeoutMs: number;
    };
    secretResolver: {
      driver: RomeoEnv["SECRET_RESOLVER_DRIVER"];
      managedSecretConfigured: boolean;
      externalValueResolverConfigured: boolean;
    };
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
    schemaVersion?: typeof dataConnectorLiveEvidenceSchema;
    evidenceStatus?: "failed" | "passed" | "planned" | "unknown";
    mode?: "dry-run" | "live" | "unknown";
    deployment?: "compose" | "kubernetes" | "target" | "unknown";
    generatedAt?: string;
    checks: Record<
      (typeof dataConnectorRequiredLiveEvidenceChecks)[number],
      boolean
    >;
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
    redaction: {
      rawAllowedHostsReturned: boolean;
      rawConnectorConfigReturned: boolean;
      rawConnectorContentReturned: boolean;
      rawEndpointUrlsReturned: boolean;
      rawEvidencePathsReturned: boolean;
      rawLogLinesReturned: boolean;
      rawSecretRefsReturned: boolean;
      secretValuesReturned: boolean;
      tokenValuesReturned: boolean;
    };
  };
  redaction: {
    evidenceFileBodiesReturned: false;
    rawAllowedHostsReturned: false;
    rawConnectorConfigReturned: false;
    rawConnectorContentReturned: false;
    rawEndpointUrlsReturned: false;
    rawEvidencePathsReturned: false;
    rawSecretRefsReturned: false;
    secretValuesReturned: false;
    tokenValuesReturned: false;
  };
  warnings: DataConnectorPostureWarning[];
}

export interface DataConnectorCatalogReport {
  executionDriver: RomeoEnv["DATA_CONNECTOR_EXECUTION_DRIVER"];
  egressPolicy: RomeoEnv["DATA_CONNECTOR_EGRESS_POLICY"];
  allowedHostRuleCount: number;
  fetchLimits: {
    maxBytes: number;
    retryAttempts: number;
    retryBackoffMs: number;
    timeoutMs: number;
  };
  secretResolver: {
    driver: RomeoEnv["SECRET_RESOLVER_DRIVER"];
    managedSecretConfigured: boolean;
    externalValueResolverConfigured: boolean;
  };
  connectors: DataConnectorCatalogItem[];
}

export interface DataConnectorCatalogItem extends DataConnectorCatalogEntry {
  runtime: {
    syncEnabled: boolean;
    blockedReasons: string[];
    warnings: string[];
    credentialPosture: Record<DataConnectorCredentialSource, boolean>;
  };
}

export const disabledCatalogPosture: DataConnectorCatalogRuntimePosture = {
  executionDriver: "disabled",
  egressPolicy: "allow_public",
  allowedHostRuleCount: 0,
  fetchMaxBytes: 2_000_000,
  fetchRetryAttempts: 1,
  fetchRetryBackoffMs: 250,
  fetchTimeoutMs: 10_000,
  liveEvidencePath: "",
  workerEnabled: false,
  networkPolicyConfigured: false,
  secretResolverDriver: "disabled",
  managedSecretConfigured: false,
  githubDeploymentTokenConfigured: false,
  delegatedOAuthGithubConfigured: false,
  s3EndpointConfigured: false,
  s3DeploymentCredentialsConfigured: false,
};

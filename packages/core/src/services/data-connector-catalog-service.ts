import { assertScope, type AuthSubject } from "@romeo/auth";

import {
  listDataConnectorCatalogEntries,
  type DataConnectorCatalogEntry,
  type DataConnectorCredentialSource,
} from "../domain/data-connector-catalog";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import type {
  DataConnectorCatalogReport,
  DataConnectorCatalogRuntimePosture,
  DataConnectorPostureReport,
} from "./data-connector-contracts";
import {
  dataConnectorCounts,
  dataConnectorSyncCounts,
  dataConnectorWarnings,
  readDataConnectorLiveEvidence,
} from "./data-connector-posture";
import {
  connectorDriverSupports,
  connectorSecretRefsSupported,
  deploymentCredentialConfigured,
} from "./data-connector-runtime-support";

export class DataConnectorCatalogService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly posture: DataConnectorCatalogRuntimePosture,
  ) {}

  catalog(subject: AuthSubject): DataConnectorCatalogReport {
    assertScope(subject, "knowledge:read");
    return {
      executionDriver: this.posture.executionDriver,
      egressPolicy: this.posture.egressPolicy,
      allowedHostRuleCount: this.posture.allowedHostRuleCount,
      fetchLimits: {
        maxBytes: this.posture.fetchMaxBytes,
        retryAttempts: this.posture.fetchRetryAttempts,
        retryBackoffMs: this.posture.fetchRetryBackoffMs,
        timeoutMs: this.posture.fetchTimeoutMs,
      },
      secretResolver: {
        driver: this.posture.secretResolverDriver,
        managedSecretConfigured: this.posture.managedSecretConfigured,
        externalValueResolverConfigured:
          this.posture.secretResolverDriver !== "disabled",
      },
      connectors: listDataConnectorCatalogEntries().map((entry) => ({
        ...entry,
        runtime: this.runtimeFor(entry),
      })),
    };
  }

  async postureReport(
    subject: AuthSubject,
  ): Promise<DataConnectorPostureReport> {
    assertScope(subject, "admin:read");
    const nowMs = Date.now();
    const [connectors, syncs, liveEvidence] = await Promise.all([
      this.repository.listDataConnectors(subject.orgId),
      this.repository.listDataConnectorSyncs(subject.orgId),
      readDataConnectorLiveEvidence(this.posture.liveEvidencePath),
    ]);
    const connectorPosture = dataConnectorCounts(connectors, nowMs);
    const syncPosture = dataConnectorSyncCounts(syncs);
    const warnings = dataConnectorWarnings({
      executionDriver: this.posture.executionDriver,
      failedSyncs: syncPosture.failed,
      liveEvidenceStatus: liveEvidence.status,
      networkPolicyConfigured: this.posture.networkPolicyConfigured,
      scheduledConnectors: connectorPosture.scheduled,
      workerEnabled: this.posture.workerEnabled,
    });
    return {
      schema: "romeo.data-connector-posture.v1",
      generatedAt: new Date(nowMs).toISOString(),
      orgId: subject.orgId,
      status: warnings.length === 0 ? "ready" : "attention_required",
      runtime: {
        executionDriver: this.posture.executionDriver,
        egressPolicy: this.posture.egressPolicy,
        managedFetchEnabled: this.posture.executionDriver !== "disabled",
        allowedHostRuleCount: this.posture.allowedHostRuleCount,
        fetchLimits: {
          maxBytes: this.posture.fetchMaxBytes,
          retryAttempts: this.posture.fetchRetryAttempts,
          retryBackoffMs: this.posture.fetchRetryBackoffMs,
          timeoutMs: this.posture.fetchTimeoutMs,
        },
        secretResolver: {
          driver: this.posture.secretResolverDriver,
          managedSecretConfigured: this.posture.managedSecretConfigured,
          externalValueResolverConfigured:
            this.posture.secretResolverDriver !== "disabled",
        },
        credentialPosture: {
          delegatedOAuthGithubConfigured:
            this.posture.delegatedOAuthGithubConfigured,
          githubDeploymentTokenConfigured:
            this.posture.githubDeploymentTokenConfigured,
          s3DeploymentCredentialsConfigured:
            this.posture.s3DeploymentCredentialsConfigured,
          s3EndpointConfigured: this.posture.s3EndpointConfigured,
        },
      },
      deployment: {
        liveEvidencePathConfigured:
          this.posture.liveEvidencePath.trim().length > 0,
        networkPolicyConfigured: this.posture.networkPolicyConfigured,
        workerEnabled: this.posture.workerEnabled,
      },
      connectors: connectorPosture,
      syncs: syncPosture,
      liveEvidence,
      redaction: {
        evidenceFileBodiesReturned: false,
        rawAllowedHostsReturned: false,
        rawConnectorConfigReturned: false,
        rawConnectorContentReturned: false,
        rawEndpointUrlsReturned: false,
        rawEvidencePathsReturned: false,
        rawSecretRefsReturned: false,
        secretValuesReturned: false,
        tokenValuesReturned: false,
      },
      warnings,
    };
  }

  assertCreateReady(entry: DataConnectorCatalogEntry): void {
    if (entry.syncMode === "inline_items") return;
    const runtime = this.runtimeFor(entry);
    if (runtime.blockedReasons.length === 0) return;
    throw new ApiError(
      "connector_runtime_not_configured",
      "Data connector runtime is not configured for this connector type.",
      409,
      { blockedReasons: runtime.blockedReasons, type: entry.type },
    );
  }

  private runtimeFor(entry: DataConnectorCatalogEntry): {
    syncEnabled: boolean;
    blockedReasons: string[];
    warnings: string[];
    credentialPosture: Record<DataConnectorCredentialSource, boolean>;
  } {
    const syncEnabled = connectorDriverSupports(
      this.posture.executionDriver,
      entry.type,
    );
    const blockedReasons: string[] = [];
    const warnings: string[] = [];
    if (!syncEnabled) blockedReasons.push("connector_driver_not_enabled");
    const needsAllowlist = [
      "website",
      "rss",
      "confluence",
      "jira",
      "notion",
      "linear",
      "slack",
    ].includes(entry.type);
    if (
      syncEnabled &&
      needsAllowlist &&
      this.posture.egressPolicy === "require_allowlist" &&
      this.posture.allowedHostRuleCount === 0
    ) {
      blockedReasons.push("egress_allowlist_required");
    }
    if (syncEnabled && entry.type === "s3") {
      if (!this.posture.s3EndpointConfigured) {
        blockedReasons.push("s3_endpoint_missing");
      }
      if (
        !this.posture.s3DeploymentCredentialsConfigured &&
        !connectorSecretRefsSupported(this.posture)
      ) {
        blockedReasons.push("s3_credentials_not_configured");
      }
    }
    if (
      syncEnabled &&
      entry.type === "github" &&
      !this.posture.githubDeploymentTokenConfigured &&
      !this.posture.delegatedOAuthGithubConfigured &&
      !connectorSecretRefsSupported(this.posture)
    ) {
      warnings.push("private_repository_credentials_not_configured");
    }
    if (
      syncEnabled &&
      (entry.type === "confluence" || entry.type === "jira") &&
      !connectorSecretRefsSupported(this.posture)
    ) {
      blockedReasons.push("atlassian_credentials_not_configured");
    }
    for (const type of ["notion", "linear", "slack"] as const) {
      if (
        syncEnabled &&
        entry.type === type &&
        !connectorSecretRefsSupported(this.posture)
      ) {
        blockedReasons.push(`${type}_credentials_not_configured`);
      }
    }
    return {
      syncEnabled,
      blockedReasons,
      warnings,
      credentialPosture: {
        none: entry.credentialSources.includes("none"),
        deployment_secret: deploymentCredentialConfigured(
          this.posture,
          entry.type,
        ),
        connector_secret_ref:
          entry.credentialSources.includes("connector_secret_ref") &&
          connectorSecretRefsSupported(this.posture),
        delegated_oauth:
          entry.type === "github" &&
          this.posture.delegatedOAuthGithubConfigured,
      },
    };
  }
}

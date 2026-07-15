import {
  assertScope,
  canAccessOrg,
  hasWorkspaceAccess,
  type AuthSubject,
} from "@romeo/auth";
import type { RomeoEnv } from "@romeo/config";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  getDataConnectorCatalogEntry,
  listDataConnectorCatalogEntries,
  type DataConnectorCatalogEntry,
  type DataConnectorCredentialSource,
} from "../domain/data-connector-catalog";
import type {
  DataConnector,
  DataConnectorSync,
  DataConnectorType,
  LocalImportSyncItem,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { assertAbuseControlsAllow } from "./abuse-control-service";
import {
  disabledDataConnectorExecutor,
  type DataConnectorExecutor,
} from "./data-connector-executors";
import { writeAuditLog } from "./audit-log";
import { getAuthorizedKnowledgeBase } from "./knowledge-access";
import type { KnowledgeService } from "./knowledge-service";
import { assertManagedSecretRef } from "./secret-refs";
import { persistedSubjectActorId } from "./subject-persisted-actor";
import { assertWorkspaceActive } from "./workspace-guard";

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

const dataConnectorLiveEvidenceSchema = "romeo.data-connector-live-evidence.v1";
const dataConnectorRequiredLiveEvidenceChecks = [
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

const disabledCatalogPosture: DataConnectorCatalogRuntimePosture = {
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

export class DataConnectorService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly knowledge: KnowledgeService,
    private readonly executor: DataConnectorExecutor = disabledDataConnectorExecutor,
    private readonly catalogPosture: DataConnectorCatalogRuntimePosture = disabledCatalogPosture,
  ) {}

  async catalog(subject: AuthSubject): Promise<DataConnectorCatalogReport> {
    assertScope(subject, "knowledge:read");
    return {
      executionDriver: this.catalogPosture.executionDriver,
      egressPolicy: this.catalogPosture.egressPolicy,
      allowedHostRuleCount: this.catalogPosture.allowedHostRuleCount,
      fetchLimits: {
        maxBytes: this.catalogPosture.fetchMaxBytes,
        retryAttempts: this.catalogPosture.fetchRetryAttempts,
        retryBackoffMs: this.catalogPosture.fetchRetryBackoffMs,
        timeoutMs: this.catalogPosture.fetchTimeoutMs,
      },
      secretResolver: {
        driver: this.catalogPosture.secretResolverDriver,
        managedSecretConfigured: this.catalogPosture.managedSecretConfigured,
        externalValueResolverConfigured:
          this.catalogPosture.secretResolverDriver !== "disabled",
      },
      connectors: listDataConnectorCatalogEntries().map((entry) => ({
        ...entry,
        runtime: this.runtimeForCatalogEntry(entry),
      })),
    };
  }

  async posture(subject: AuthSubject): Promise<DataConnectorPostureReport> {
    assertScope(subject, "admin:read");
    const nowMs = Date.now();
    const connectors = await this.repository.listDataConnectors(subject.orgId);
    const syncs = await this.repository.listDataConnectorSyncs(subject.orgId);
    const liveEvidence = await readDataConnectorLiveEvidence(
      this.catalogPosture.liveEvidencePath,
    );
    const connectorPosture = dataConnectorCounts(connectors, nowMs);
    const syncPosture = dataConnectorSyncCounts(syncs);
    const warnings = dataConnectorWarnings({
      executionDriver: this.catalogPosture.executionDriver,
      failedSyncs: syncPosture.failed,
      liveEvidenceStatus: liveEvidence.status,
      networkPolicyConfigured: this.catalogPosture.networkPolicyConfigured,
      scheduledConnectors: connectorPosture.scheduled,
      workerEnabled: this.catalogPosture.workerEnabled,
    });
    return {
      schema: "romeo.data-connector-posture.v1",
      generatedAt: new Date(nowMs).toISOString(),
      orgId: subject.orgId,
      status: warnings.length === 0 ? "ready" : "attention_required",
      runtime: {
        executionDriver: this.catalogPosture.executionDriver,
        egressPolicy: this.catalogPosture.egressPolicy,
        managedFetchEnabled: this.catalogPosture.executionDriver !== "disabled",
        allowedHostRuleCount: this.catalogPosture.allowedHostRuleCount,
        fetchLimits: {
          maxBytes: this.catalogPosture.fetchMaxBytes,
          retryAttempts: this.catalogPosture.fetchRetryAttempts,
          retryBackoffMs: this.catalogPosture.fetchRetryBackoffMs,
          timeoutMs: this.catalogPosture.fetchTimeoutMs,
        },
        secretResolver: {
          driver: this.catalogPosture.secretResolverDriver,
          managedSecretConfigured: this.catalogPosture.managedSecretConfigured,
          externalValueResolverConfigured:
            this.catalogPosture.secretResolverDriver !== "disabled",
        },
        credentialPosture: {
          delegatedOAuthGithubConfigured:
            this.catalogPosture.delegatedOAuthGithubConfigured,
          githubDeploymentTokenConfigured:
            this.catalogPosture.githubDeploymentTokenConfigured,
          s3DeploymentCredentialsConfigured:
            this.catalogPosture.s3DeploymentCredentialsConfigured,
          s3EndpointConfigured: this.catalogPosture.s3EndpointConfigured,
        },
      },
      deployment: {
        liveEvidencePathConfigured:
          this.catalogPosture.liveEvidencePath.trim().length > 0,
        networkPolicyConfigured: this.catalogPosture.networkPolicyConfigured,
        workerEnabled: this.catalogPosture.workerEnabled,
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

  async list(
    subject: AuthSubject,
    workspaceId?: string,
  ): Promise<DataConnector[]> {
    assertScope(subject, "knowledge:read");
    const targetWorkspaceId = workspaceId ?? subject.workspaceIds[0];
    if (targetWorkspaceId === undefined) return [];
    if (!hasWorkspaceAccess(subject, targetWorkspaceId))
      throw new ApiError(
        "forbidden",
        "The workspace is outside the caller access.",
        403,
      );
    return this.repository.listDataConnectors(subject.orgId, targetWorkspaceId);
  }

  private runtimeForCatalogEntry(entry: DataConnectorCatalogEntry): {
    syncEnabled: boolean;
    blockedReasons: string[];
    warnings: string[];
    credentialPosture: Record<DataConnectorCredentialSource, boolean>;
  } {
    const syncEnabled = connectorDriverSupports(
      this.catalogPosture.executionDriver,
      entry.type,
    );
    const blockedReasons: string[] = [];
    const warnings: string[] = [];
    if (!syncEnabled) blockedReasons.push("connector_driver_not_enabled");
    if (
      syncEnabled &&
      (entry.type === "website" ||
        entry.type === "rss" ||
        entry.type === "confluence" ||
        entry.type === "jira" ||
        entry.type === "notion" ||
        entry.type === "linear" ||
        entry.type === "slack") &&
      this.catalogPosture.egressPolicy === "require_allowlist" &&
      this.catalogPosture.allowedHostRuleCount === 0
    ) {
      blockedReasons.push("egress_allowlist_required");
    }
    if (syncEnabled && entry.type === "s3") {
      if (!this.catalogPosture.s3EndpointConfigured)
        blockedReasons.push("s3_endpoint_missing");
      if (
        !this.catalogPosture.s3DeploymentCredentialsConfigured &&
        !connectorSecretRefsSupported(this.catalogPosture)
      ) {
        blockedReasons.push("s3_credentials_not_configured");
      }
    }
    if (
      syncEnabled &&
      entry.type === "github" &&
      !this.catalogPosture.githubDeploymentTokenConfigured &&
      !this.catalogPosture.delegatedOAuthGithubConfigured &&
      !connectorSecretRefsSupported(this.catalogPosture)
    ) {
      warnings.push("private_repository_credentials_not_configured");
    }
    if (
      syncEnabled &&
      (entry.type === "confluence" || entry.type === "jira") &&
      !connectorSecretRefsSupported(this.catalogPosture)
    ) {
      blockedReasons.push("atlassian_credentials_not_configured");
    }
    if (
      syncEnabled &&
      entry.type === "notion" &&
      !connectorSecretRefsSupported(this.catalogPosture)
    ) {
      blockedReasons.push("notion_credentials_not_configured");
    }
    if (
      syncEnabled &&
      entry.type === "linear" &&
      !connectorSecretRefsSupported(this.catalogPosture)
    ) {
      blockedReasons.push("linear_credentials_not_configured");
    }
    if (
      syncEnabled &&
      entry.type === "slack" &&
      !connectorSecretRefsSupported(this.catalogPosture)
    ) {
      blockedReasons.push("slack_credentials_not_configured");
    }

    return {
      syncEnabled,
      blockedReasons,
      warnings,
      credentialPosture: {
        none: entry.credentialSources.includes("none"),
        deployment_secret: deploymentCredentialConfigured(
          this.catalogPosture,
          entry.type,
        ),
        connector_secret_ref:
          entry.credentialSources.includes("connector_secret_ref") &&
          connectorSecretRefsSupported(this.catalogPosture),
        delegated_oauth:
          entry.type === "github" &&
          this.catalogPosture.delegatedOAuthGithubConfigured,
      },
    };
  }

  async create(input: {
    subject: AuthSubject;
    workspaceId: string;
    knowledgeBaseId: string;
    type: DataConnectorType;
    name: string;
    config: Record<string, unknown>;
    syncIntervalMinutes?: number;
  }): Promise<DataConnector> {
    const knowledgeBase = await getAuthorizedKnowledgeBase(this.repository, {
      knowledgeBaseId: input.knowledgeBaseId,
      subject: input.subject,
      scope: "knowledge:write",
      permission: "write",
    });
    if (knowledgeBase.workspaceId !== input.workspaceId) {
      throw new ApiError(
        "connector_workspace_mismatch",
        "Connector workspace must match the knowledge base workspace.",
        400,
      );
    }
    const catalogEntry = getDataConnectorCatalogEntry(input.type);
    const config = normalizeConnectorConfig(input.type, input.config);
    this.assertConnectorCreateReady(catalogEntry);
    await assertWorkspaceActive(this.repository, {
      orgId: input.subject.orgId,
      workspaceId: input.workspaceId,
    });
    if (input.syncIntervalMinutes !== undefined) {
      await assertAbuseControlsAllow(this.repository, input.subject, {
        action: "worker.enqueue",
        workspaceId: input.workspaceId,
        workerClass: "data_connector.sync",
      });
    }

    const now = new Date().toISOString();
    return this.repository.transaction(async (repository) => {
      const createdBy = await persistedSubjectActorId(
        repository,
        input.subject,
        {
          kind: "service_account_data_connector_owner",
          name: "Service Account Data Connector Owner",
        },
      );
      const connector = await repository.createDataConnector({
        id: createId("data_connector"),
        orgId: input.subject.orgId,
        workspaceId: input.workspaceId,
        knowledgeBaseId: knowledgeBase.id,
        type: input.type,
        name: input.name,
        config,
        status: "active",
        ...scheduleFields(input.syncIntervalMinutes, now),
        createdBy,
        createdAt: now,
        updatedAt: now,
      });
      await this.audit(
        input.subject,
        "data_connector.create",
        connector.id,
        "success",
        { type: connector.type, knowledgeBaseId: connector.knowledgeBaseId },
        repository,
      );
      return connector;
    });
  }

  private assertConnectorCreateReady(entry: DataConnectorCatalogEntry): void {
    if (entry.syncMode === "inline_items") return;
    const runtime = this.runtimeForCatalogEntry(entry);
    if (runtime.blockedReasons.length === 0) return;
    throw new ApiError(
      "connector_runtime_not_configured",
      "Data connector runtime is not configured for this connector type.",
      409,
      {
        blockedReasons: runtime.blockedReasons,
        type: entry.type,
      },
    );
  }

  async sync(input: {
    subject: AuthSubject;
    connectorId: string;
    items?: LocalImportSyncItem[];
  }): Promise<DataConnectorSync> {
    const connector = await this.getAuthorizedConnector(
      input.subject,
      input.connectorId,
    );
    await assertWorkspaceActive(this.repository, {
      orgId: input.subject.orgId,
      workspaceId: connector.workspaceId,
    });
    await getAuthorizedKnowledgeBase(this.repository, {
      knowledgeBaseId: connector.knowledgeBaseId,
      subject: input.subject,
      scope: "knowledge:write",
      permission: "write",
    });
    await assertAbuseControlsAllow(this.repository, input.subject, {
      action: "connector.sync",
      connectorId: connector.id,
      workspaceId: connector.workspaceId,
      workerClass: "data_connector.sync",
    });
    const previousSync = await this.latestCompletedSync(connector);

    const startedAt = new Date().toISOString();
    const createdBy = await persistedSubjectActorId(
      this.repository,
      input.subject,
      {
        kind: "service_account_data_connector_sync",
        name: "Service Account Data Connector Sync Actor",
      },
    );
    const sync = await this.repository.createDataConnectorSync({
      id: createId("connector_sync"),
      orgId: connector.orgId,
      workspaceId: connector.workspaceId,
      knowledgeBaseId: connector.knowledgeBaseId,
      connectorId: connector.id,
      status: "running",
      createdBy,
      itemCount: input.items?.length ?? 0,
      sourceIds: [],
      summary: { connectorType: connector.type },
      startedAt,
    });

    try {
      const execution = await this.resolveSyncItems(connector, input.items);
      const sourceIds: string[] = [];
      const previousCursor = localImportCursor(connector.config);
      const nextCursor: LocalImportCursorEntry[] = [];
      let createdSourceCount = 0;
      let reusedSourceCount = 0;
      for (const item of execution.items) {
        const contentHash = hashContent(item.content);
        const previous = previousCursor.find(
          (entry) =>
            entry.fileName === item.fileName &&
            entry.contentHash === contentHash,
        );
        if (
          previous !== undefined &&
          (await this.sourceExists(
            connector.knowledgeBaseId,
            previous.sourceId,
          ))
        ) {
          sourceIds.push(previous.sourceId);
          nextCursor.push(previous);
          reusedSourceCount += 1;
          continue;
        }

        const source = await this.knowledge.createSource({
          subject: input.subject,
          knowledgeBaseId: connector.knowledgeBaseId,
          fileName: item.fileName,
          metadata: connectorSourceMetadata(connector),
          mimeType: item.mimeType,
          sizeBytes:
            item.sizeBytes ?? new TextEncoder().encode(item.content).length,
          content: item.content,
        });
        sourceIds.push(source.id);
        nextCursor.push({
          fileName: item.fileName,
          contentHash,
          sourceId: source.id,
        });
        createdSourceCount += 1;
      }
      const deletedSourceIds = await this.deleteSupersededSources(
        input.subject,
        connector,
        previousSync?.sourceIds ?? [],
        sourceIds,
      );

      const completed = await this.repository.transaction(
        async (repository) => {
          const completedAt = new Date().toISOString();
          const finalized = await repository.updateDataConnectorSync({
            ...sync,
            status: "completed",
            itemCount: execution.items.length,
            sourceIds,
            summary: {
              connectorType: connector.type,
              ...(execution.summary ?? {}),
              sourceAccessMode: connectorSourceAccessMode(connector.config),
              sourceCount: sourceIds.length,
              createdSourceCount,
              reusedSourceCount,
              deletedSourceCount: deletedSourceIds.length,
              deletedSourceIds,
            },
            completedAt,
          });
          await repository.updateDataConnector({
            ...connector,
            config: { ...connector.config, lastCursor: nextCursor },
            ...nextScheduleFields(connector, completedAt),
            lastSyncAt: completedAt,
            updatedAt: completedAt,
          });
          await this.audit(
            input.subject,
            "data_connector.sync",
            connector.id,
            "success",
            {
              syncId: finalized.id,
              sourceCount: sourceIds.length,
              createdSourceCount,
              reusedSourceCount,
              deletedSourceCount: deletedSourceIds.length,
            },
            repository,
          );
          return finalized;
        },
      );
      return completed;
    } catch (error) {
      return this.failSync(
        input.subject,
        sync,
        connector,
        error instanceof ApiError ? error.code : "connector_sync_failed",
        error instanceof ApiError ? error.status : 500,
      );
    }
  }

  async syncs(
    subject: AuthSubject,
    connectorId: string,
  ): Promise<DataConnectorSync[]> {
    const connector = await this.getAuthorizedConnector(subject, connectorId);
    await getAuthorizedKnowledgeBase(this.repository, {
      knowledgeBaseId: connector.knowledgeBaseId,
      subject,
      scope: "knowledge:read",
      permission: "read",
    });
    return this.repository.listDataConnectorSyncs(subject.orgId, connector.id);
  }

  private async latestCompletedSync(
    connector: DataConnector,
  ): Promise<DataConnectorSync | undefined> {
    return (
      await this.repository.listDataConnectorSyncs(
        connector.orgId,
        connector.id,
      )
    ).find((sync) => sync.status === "completed");
  }

  private async sourceExists(
    knowledgeBaseId: string,
    sourceId: string,
  ): Promise<boolean> {
    return (await this.repository.listKnowledgeSources(knowledgeBaseId)).some(
      (source) => source.id === sourceId,
    );
  }

  private async resolveSyncItems(
    connector: DataConnector,
    items: LocalImportSyncItem[] | undefined,
  ) {
    if (connector.type === "local_import") {
      if (!items || items.length === 0) {
        throw new ApiError(
          "connector_sync_items_required",
          "Local import connector sync requires at least one item.",
          400,
        );
      }
      return { items };
    }
    if (items !== undefined)
      throw new ApiError(
        "connector_sync_items_unsupported",
        "Managed connector sync does not accept inline items.",
        400,
      );
    return this.executor.sync(connector);
  }

  private async deleteSupersededSources(
    subject: AuthSubject,
    connector: DataConnector,
    previousSourceIds: string[],
    currentSourceIds: string[],
  ): Promise<string[]> {
    const current = new Set(currentSourceIds);
    const existing = new Set(
      (
        await this.repository.listKnowledgeSources(connector.knowledgeBaseId)
      ).map((source) => source.id),
    );
    const deleted: string[] = [];
    for (const sourceId of previousSourceIds) {
      if (current.has(sourceId) || !existing.has(sourceId)) continue;
      await this.knowledge.deleteSource({
        subject,
        knowledgeBaseId: connector.knowledgeBaseId,
        sourceId,
      });
      deleted.push(sourceId);
    }
    return deleted;
  }

  private async getAuthorizedConnector(
    subject: AuthSubject,
    connectorId: string,
  ): Promise<DataConnector> {
    assertScope(subject, "knowledge:read");
    const connector = await this.repository.getDataConnector(connectorId);
    if (!connector) throw notFound("Data connector");
    if (!canAccessOrg(subject, connector.orgId))
      throw new ApiError(
        "forbidden",
        "The connector is outside the caller organization.",
        403,
      );
    if (!hasWorkspaceAccess(subject, connector.workspaceId))
      throw new ApiError(
        "forbidden",
        "The connector is outside the caller workspace access.",
        403,
      );
    return connector;
  }

  private async failSync(
    subject: AuthSubject,
    sync: DataConnectorSync,
    connector: DataConnector,
    errorCode: string,
    statusCode: ContentfulStatusCode,
  ): Promise<never> {
    const completedAt = new Date().toISOString();
    await this.repository.transaction(async (repository) => {
      await repository.updateDataConnectorSync({
        ...sync,
        status: "failed",
        errorCode,
        summary: { connectorType: connector.type, errorCode },
        completedAt,
      });
      await repository.updateDataConnector({
        ...connector,
        ...nextScheduleFields(connector, completedAt),
        updatedAt: completedAt,
      });
      await this.audit(
        subject,
        "data_connector.sync",
        connector.id,
        "failure",
        { syncId: sync.id, errorCode },
        repository,
      );
    });
    throw new ApiError(
      errorCode,
      connectorSyncErrorMessage(errorCode),
      statusCode,
    );
  }

  private async audit(
    subject: AuthSubject,
    action: string,
    resourceId: string,
    outcome: "success" | "failure",
    metadata: Record<string, unknown>,
    repository: RomeoRepository = this.repository,
  ): Promise<void> {
    await writeAuditLog(repository, {
      subject,
      action,
      resourceType: "data_connector",
      resourceId,
      outcome,
      metadata,
    });
  }
}

interface LocalImportCursorEntry {
  fileName: string;
  contentHash: string;
  sourceId: string;
}

function localImportCursor(
  config: Record<string, unknown>,
): LocalImportCursorEntry[] {
  const cursor = config.lastCursor;
  if (!Array.isArray(cursor)) return [];
  return cursor.filter(isLocalImportCursorEntry);
}

function isLocalImportCursorEntry(
  value: unknown,
): value is LocalImportCursorEntry {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<LocalImportCursorEntry>;
  return (
    typeof candidate.fileName === "string" &&
    typeof candidate.contentHash === "string" &&
    typeof candidate.sourceId === "string"
  );
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function dataConnectorCounts(
  connectors: DataConnector[],
  nowMs: number,
): DataConnectorPostureReport["connectors"] {
  const byType = Object.fromEntries(
    listDataConnectorCatalogEntries().map((entry) => [entry.type, 0]),
  ) as Record<DataConnectorType, number>;
  let active = 0;
  let disabled = 0;
  let due = 0;
  let managed = 0;
  let scheduled = 0;
  for (const connector of connectors) {
    byType[connector.type] += 1;
    if (connector.status === "active") active += 1;
    if (connector.status === "disabled") disabled += 1;
    if (connector.type !== "local_import") managed += 1;
    if (connector.syncIntervalMinutes !== undefined) scheduled += 1;
    if (
      connector.status === "active" &&
      connector.nextSyncAt !== undefined &&
      Date.parse(connector.nextSyncAt) <= nowMs
    ) {
      due += 1;
    }
  }
  return {
    active,
    disabled,
    due,
    managed,
    scheduled,
    total: connectors.length,
    byType,
  };
}

function dataConnectorSyncCounts(
  syncs: DataConnectorSync[],
): DataConnectorPostureReport["syncs"] {
  let completed = 0;
  let failed = 0;
  let latestCompletedAt: string | null = null;
  let latestFailedAt: string | null = null;
  let running = 0;
  for (const sync of syncs) {
    if (sync.status === "running") running += 1;
    if (sync.status === "completed") {
      completed += 1;
      if (
        sync.completedAt !== undefined &&
        (latestCompletedAt === null ||
          sync.completedAt.localeCompare(latestCompletedAt) > 0)
      ) {
        latestCompletedAt = sync.completedAt;
      }
    }
    if (sync.status === "failed") {
      failed += 1;
      if (
        sync.completedAt !== undefined &&
        (latestFailedAt === null ||
          sync.completedAt.localeCompare(latestFailedAt) > 0)
      ) {
        latestFailedAt = sync.completedAt;
      }
    }
  }
  return {
    completed,
    failed,
    latestCompletedAt,
    latestFailedAt,
    running,
    total: syncs.length,
  };
}

async function readDataConnectorLiveEvidence(
  evidencePath: string,
): Promise<DataConnectorPostureReport["liveEvidence"]> {
  const emptyChecks = emptyDataConnectorLiveEvidenceChecks();
  const notConfigured: DataConnectorPostureReport["liveEvidence"] = {
    configured: false,
    source: "not_configured",
    status: "not_configured",
    checks: emptyChecks,
    failureCodes: [],
    summary: emptyDataConnectorLiveEvidenceSummary(),
    redaction: dataConnectorLiveEvidenceRedaction(),
  };
  if (evidencePath.trim().length === 0) return notConfigured;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(evidencePath, "utf8"));
  } catch (error) {
    return {
      ...notConfigured,
      configured: true,
      source: "configured_file",
      status: "invalid",
      failureCodes: [isSyntaxError(error) ? "invalid_json" : "read_failed"],
      invalidReason: isSyntaxError(error) ? "invalid_json" : "read_failed",
    };
  }
  if (!isRecord(parsed)) {
    return invalidDataConnectorLiveEvidence("schema_mismatch", [
      "evidence_not_object",
    ]);
  }
  const schemaVersion =
    stringValue(parsed.schemaVersion) ?? stringValue(parsed.schema);
  if (schemaVersion !== dataConnectorLiveEvidenceSchema) {
    return invalidDataConnectorLiveEvidence("schema_mismatch", [
      "schema_mismatch",
    ]);
  }
  const checks = dataConnectorLiveEvidenceChecks(parsed.checks);
  const summary = dataConnectorLiveEvidenceSummary(parsed);
  const redaction = dataConnectorLiveEvidenceRedactionFrom(parsed.redaction);
  const evidenceStatus = evidenceStatusValue(parsed.status);
  const mode = modeValue(parsed.mode);
  const deployment = deploymentValue(parsed.deployment);
  const failureCodes = dataConnectorLiveEvidenceFailureCodes({
    checks,
    deployment,
    evidence: parsed,
    evidenceStatus,
    mode,
    redaction,
    summary,
  });
  const failed = evidenceStatus !== "passed" || failureCodes.length > 0;
  return {
    configured: true,
    source: "configured_file",
    status: failed ? "failed" : "satisfied",
    schemaVersion: dataConnectorLiveEvidenceSchema,
    evidenceStatus,
    ...(typeof parsed.generatedAt === "string"
      ? { generatedAt: parsed.generatedAt }
      : {}),
    mode,
    deployment,
    checks,
    failureCodes,
    summary,
    redaction,
  };
}

function invalidDataConnectorLiveEvidence(
  invalidReason: "invalid_json" | "read_failed" | "schema_mismatch",
  failureCodes: string[],
): DataConnectorPostureReport["liveEvidence"] {
  return {
    configured: true,
    source: "configured_file",
    status: "invalid",
    checks: emptyDataConnectorLiveEvidenceChecks(),
    failureCodes,
    invalidReason,
    summary: emptyDataConnectorLiveEvidenceSummary(),
    redaction: dataConnectorLiveEvidenceRedaction(),
  };
}

function emptyDataConnectorLiveEvidenceChecks(): DataConnectorPostureReport["liveEvidence"]["checks"] {
  return Object.fromEntries(
    dataConnectorRequiredLiveEvidenceChecks.map((check) => [check, false]),
  ) as DataConnectorPostureReport["liveEvidence"]["checks"];
}

function dataConnectorLiveEvidenceChecks(
  value: unknown,
): DataConnectorPostureReport["liveEvidence"]["checks"] {
  const source = Array.isArray(value) ? value : [];
  const passed = new Set(
    source.flatMap((item) => {
      if (typeof item === "string") return [item];
      if (isRecord(item)) {
        const id =
          typeof item.id === "string"
            ? item.id
            : typeof item.name === "string"
              ? item.name
              : undefined;
        if (
          id !== undefined &&
          (item.status === "passed" ||
            item.status === "pass" ||
            item.passed === true)
        ) {
          return [id];
        }
      }
      return [];
    }),
  );
  return Object.fromEntries(
    dataConnectorRequiredLiveEvidenceChecks.map((check) => [
      check,
      passed.has(check),
    ]),
  ) as DataConnectorPostureReport["liveEvidence"]["checks"];
}

function emptyDataConnectorLiveEvidenceSummary(): DataConnectorPostureReport["liveEvidence"]["summary"] {
  return {
    delegatedOAuthConnectorCount: 0,
    deniedPrivateTargetCount: 0,
    failedSyncCount: 0,
    managedConnectorTypeCount: 0,
    podLogScanCount: 0,
    requeuedSyncCount: 0,
    secretRefConnectorCount: 0,
    successfulSyncCount: 0,
    syncAttemptCount: 0,
    workerLogScanCount: 0,
  };
}

function dataConnectorLiveEvidenceSummary(
  evidence: Record<string, unknown>,
): DataConnectorPostureReport["liveEvidence"]["summary"] {
  const connectors = recordValue(evidence.connectors);
  const logRedaction = recordValue(evidence.logRedaction);
  const worker = recordValue(evidence.worker);
  return {
    delegatedOAuthConnectorCount: nonNegativeNumber(
      connectors.delegatedOAuthConnectorCount,
    ),
    deniedPrivateTargetCount: nonNegativeNumber(
      connectors.deniedPrivateTargetCount,
    ),
    failedSyncCount: nonNegativeNumber(connectors.failedSyncCount),
    managedConnectorTypeCount: nonNegativeNumber(
      connectors.managedConnectorTypeCount,
    ),
    podLogScanCount: nonNegativeNumber(logRedaction.podLogScanCount),
    requeuedSyncCount: nonNegativeNumber(worker.requeuedSyncCount),
    secretRefConnectorCount: nonNegativeNumber(
      connectors.secretRefConnectorCount,
    ),
    successfulSyncCount: nonNegativeNumber(connectors.successfulSyncCount),
    syncAttemptCount: nonNegativeNumber(connectors.syncAttemptCount),
    workerLogScanCount: nonNegativeNumber(logRedaction.workerLogScanCount),
  };
}

function dataConnectorLiveEvidenceRedaction(): DataConnectorPostureReport["liveEvidence"]["redaction"] {
  return {
    rawAllowedHostsReturned: false,
    rawConnectorConfigReturned: false,
    rawConnectorContentReturned: false,
    rawEndpointUrlsReturned: false,
    rawEvidencePathsReturned: false,
    rawLogLinesReturned: false,
    rawSecretRefsReturned: false,
    secretValuesReturned: false,
    tokenValuesReturned: false,
  };
}

function dataConnectorLiveEvidenceRedactionFrom(
  value: unknown,
): DataConnectorPostureReport["liveEvidence"]["redaction"] {
  if (!isRecord(value)) return dataConnectorLiveEvidenceRedaction();
  return {
    rawAllowedHostsReturned: value.rawAllowedHostsReturned === true,
    rawConnectorConfigReturned: value.rawConnectorConfigReturned === true,
    rawConnectorContentReturned: value.rawConnectorContentReturned === true,
    rawEndpointUrlsReturned: value.rawEndpointUrlsReturned === true,
    rawEvidencePathsReturned: value.rawEvidencePathsReturned === true,
    rawLogLinesReturned: value.rawLogLinesReturned === true,
    rawSecretRefsReturned: value.rawSecretRefsReturned === true,
    secretValuesReturned: value.secretValuesReturned === true,
    tokenValuesReturned: value.tokenValuesReturned === true,
  };
}

function allDataConnectorLiveEvidenceRedactionFalse(
  redaction: DataConnectorPostureReport["liveEvidence"]["redaction"],
): boolean {
  return Object.values(redaction).every((value) => value === false);
}

function dataConnectorLiveEvidenceFailureCodes(input: {
  checks: DataConnectorPostureReport["liveEvidence"]["checks"];
  deployment: DataConnectorPostureReport["liveEvidence"]["deployment"];
  evidence: Record<string, unknown>;
  evidenceStatus: DataConnectorPostureReport["liveEvidence"]["evidenceStatus"];
  mode: DataConnectorPostureReport["liveEvidence"]["mode"];
  redaction: DataConnectorPostureReport["liveEvidence"]["redaction"];
  summary: DataConnectorPostureReport["liveEvidence"]["summary"];
}): string[] {
  const failures: string[] = [];
  if (input.evidenceStatus !== "passed") {
    failures.push("data_connector_live_not_passed");
  }
  if (input.mode !== "live") {
    failures.push("data_connector_live_evidence_not_live");
  }
  if (input.deployment !== "kubernetes" && input.deployment !== "target") {
    failures.push("data_connector_live_deployment_invalid");
  }
  for (const check of dataConnectorRequiredLiveEvidenceChecks) {
    if (input.checks[check] !== true) {
      failures.push(`data_connector_live_missing_check:${check}`);
    }
  }

  const egress = recordValue(input.evidence.egress);
  const secrets = recordValue(input.evidence.secrets);
  const worker = recordValue(input.evidence.worker);
  const logRedaction = recordValue(input.evidence.logRedaction);
  const readback = recordValue(input.evidence.readback);

  if (
    input.summary.managedConnectorTypeCount <= 0 ||
    input.summary.syncAttemptCount <= 0 ||
    input.summary.successfulSyncCount <= 0
  ) {
    failures.push("data_connector_live_managed_sync_invalid");
  }
  if (
    egress.workerCniOrNetworkPolicyEnforced !== true ||
    egress.allowlistRequired !== true ||
    egress.privateNetworkDenied !== true ||
    nonNegativeNumber(egress.deniedPrivateNetworkCount) <= 0 ||
    nonNegativeNumber(egress.allowedExternalHostCount) <= 0
  ) {
    failures.push("data_connector_live_egress_invalid");
  }
  if (
    egress.dnsRebindingDenied !== true ||
    input.summary.deniedPrivateTargetCount <= 0
  ) {
    failures.push("data_connector_live_private_dns_invalid");
  }
  if (
    secrets.secretRefResolutionVerified !== true ||
    secrets.secretResolverBoundaryVerified !== true ||
    input.summary.secretRefConnectorCount <= 0 ||
    secrets.rawSecretValuesReturned !== false ||
    secrets.tokenValuesReturned !== false
  ) {
    failures.push("data_connector_live_secret_resolution_invalid");
  }
  if (
    worker.workerExecutionVerified !== true ||
    worker.crashRetryOrRequeueVerified !== true ||
    input.summary.requeuedSyncCount <= 0 ||
    worker.completedAfterRetry !== true
  ) {
    failures.push("data_connector_live_worker_retry_invalid");
  }
  if (
    logRedaction.syncLogRedactionVerified !== true ||
    logRedaction.podLogRedactionVerified !== true ||
    input.summary.podLogScanCount <= 0 ||
    input.summary.workerLogScanCount <= 0 ||
    nonNegativeNumber(logRedaction.connectorContentSentinelHitCount) !== 0 ||
    nonNegativeNumber(logRedaction.secretSentinelHitCount) !== 0 ||
    nonNegativeNumber(logRedaction.tokenSentinelHitCount) !== 0
  ) {
    failures.push("data_connector_live_log_redaction_invalid");
  }
  if (
    readback.adminPostureReadbackVerified !== true ||
    readback.syncHistoryReadbackVerified !== true
  ) {
    failures.push("data_connector_live_readback_invalid");
  }
  if (
    !isRecord(input.evidence.redaction) ||
    !allDataConnectorLiveEvidenceRedactionFalse(input.redaction)
  ) {
    failures.push("data_connector_live_redaction_missing");
  }
  return Array.from(new Set(failures));
}

function dataConnectorWarnings(input: {
  executionDriver: RomeoEnv["DATA_CONNECTOR_EXECUTION_DRIVER"];
  failedSyncs: number;
  liveEvidenceStatus: DataConnectorPostureReport["liveEvidence"]["status"];
  networkPolicyConfigured: boolean;
  scheduledConnectors: number;
  workerEnabled: boolean;
}): DataConnectorPostureReport["warnings"] {
  const warnings: DataConnectorPostureReport["warnings"] = [];
  if (input.executionDriver === "disabled")
    warnings.push("data_connector_driver_disabled");
  if (!input.workerEnabled) warnings.push("data_connector_worker_not_enabled");
  if (!input.networkPolicyConfigured)
    warnings.push("data_connector_network_policy_not_configured");
  if (input.scheduledConnectors > 0 && !input.workerEnabled)
    warnings.push("data_connector_scheduled_syncs_without_worker");
  if (input.liveEvidenceStatus === "not_configured")
    warnings.push("data_connector_live_evidence_required");
  if (
    input.liveEvidenceStatus === "invalid" ||
    input.liveEvidenceStatus === "failed"
  ) {
    warnings.push("data_connector_live_evidence_invalid");
  }
  if (input.failedSyncs > 0)
    warnings.push("data_connector_failed_syncs_present");
  return warnings;
}

function normalizeConnectorConfig(
  type: DataConnectorType,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const catalogEntry = getDataConnectorCatalogEntry(type);
  if (catalogEntry.implementationStatus !== "implemented") {
    throw new ApiError(
      "connector_type_not_implemented",
      "Data connector type is not implemented.",
      400,
      { type },
    );
  }
  if (type === "local_import")
    return withOptionalSourceAccessMode({ mode: "manual" }, config);
  if (type === "github")
    return withOptionalSourceAccessMode(normalizeGitHubConfig(config), config);
  if (type === "s3")
    return withOptionalSourceAccessMode(normalizeS3Config(config), config);
  if (type === "confluence")
    return withOptionalSourceAccessMode(
      normalizeAtlassianConfig(config, {
        apiPath: "/wiki/rest/api/content/search",
        queryKey: "cql",
      }),
      config,
    );
  if (type === "jira")
    return withOptionalSourceAccessMode(
      normalizeAtlassianConfig(config, {
        apiPath: "/rest/api/3/search/jql",
        queryKey: "jql",
      }),
      config,
    );
  if (type === "notion")
    return withOptionalSourceAccessMode(normalizeNotionConfig(config), config);
  if (type === "linear")
    return withOptionalSourceAccessMode(normalizeLinearConfig(config), config);
  if (type === "slack")
    return withOptionalSourceAccessMode(normalizeSlackConfig(config), config);
  if (type === "website") {
    return withOptionalSourceAccessMode(
      {
        url: normalizeExternalHttpsUrl(requiredString(config, "url")),
        maxPages: boundedInt(config.maxPages, 1, 100, 10, "maxPages"),
      },
      config,
    );
  }
  if (type === "rss") {
    return withOptionalSourceAccessMode(
      {
        url: normalizeExternalHttpsUrl(requiredString(config, "url")),
        maxItems: boundedInt(config.maxItems, 1, 100, 20, "maxItems"),
      },
      config,
    );
  }
  return unsupportedConnectorType(type);
}

function unsupportedConnectorType(type: never): never {
  throw new ApiError(
    "connector_type_not_implemented",
    "Data connector type is not implemented.",
    400,
    { type },
  );
}

function recordValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function nonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

function evidenceStatusValue(
  value: unknown,
): "failed" | "passed" | "planned" | "unknown" {
  if (value === "failed" || value === "passed" || value === "planned") {
    return value;
  }
  return "unknown";
}

function modeValue(value: unknown): "dry-run" | "live" | "unknown" {
  if (value === "dry-run" || value === "live") return value;
  return "unknown";
}

function deploymentValue(
  value: unknown,
): "compose" | "kubernetes" | "target" | "unknown" {
  if (value === "compose" || value === "kubernetes" || value === "target") {
    return value;
  }
  return "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isSyntaxError(error: unknown): boolean {
  return error instanceof SyntaxError;
}

function connectorDriverSupports(
  driver: RomeoEnv["DATA_CONNECTOR_EXECUTION_DRIVER"],
  type: DataConnectorType,
): boolean {
  if (type === "local_import") return true;
  if (driver === "managed-fetch") return true;
  if (driver === "website-fetch") return type === "website" || type === "rss";
  if (driver === "github-fetch") return type === "github";
  if (driver === "s3-fetch") return type === "s3";
  if (driver === "atlassian-fetch")
    return type === "confluence" || type === "jira";
  if (driver === "notion-fetch") return type === "notion";
  if (driver === "linear-fetch") return type === "linear";
  if (driver === "slack-fetch") return type === "slack";
  return false;
}

function connectorSecretRefsSupported(
  posture: DataConnectorCatalogRuntimePosture,
): boolean {
  return (
    posture.managedSecretConfigured ||
    posture.secretResolverDriver !== "disabled"
  );
}

function deploymentCredentialConfigured(
  posture: DataConnectorCatalogRuntimePosture,
  type: DataConnectorType,
): boolean {
  if (type === "github") return posture.githubDeploymentTokenConfigured;
  if (type === "s3") return posture.s3DeploymentCredentialsConfigured;
  return false;
}

function normalizeAtlassianConfig(
  config: Record<string, unknown>,
  defaults: { apiPath: string; queryKey: "cql" | "jql" },
): Record<string, unknown> {
  return withRequiredSecretRef(
    {
      baseUrl: normalizeExternalHttpsUrl(requiredString(config, "baseUrl")),
      apiPath: normalizeApiPath(
        optionalString(config, "apiPath") ?? defaults.apiPath,
      ),
      [defaults.queryKey]: boundedString(
        requiredString(config, defaults.queryKey),
        1_000,
        defaults.queryKey,
      ),
      maxItems: boundedInt(config.maxItems, 1, 100, 25, "maxItems"),
    },
    config,
  );
}

function normalizeNotionConfig(
  config: Record<string, unknown>,
): Record<string, unknown> {
  return withRequiredSecretRef(
    {
      apiUrl: normalizeExternalHttpsUrl(
        optionalString(config, "apiUrl") ?? "https://api.notion.com",
      ),
      apiVersion: normalizeDateVersion(
        optionalString(config, "apiVersion") ?? "2026-03-11",
        "apiVersion",
      ),
      query: boundedString(requiredString(config, "query"), 500, "query"),
      maxItems: boundedInt(config.maxItems, 1, 100, 25, "maxItems"),
      maxBlocksPerPage: boundedInt(
        config.maxBlocksPerPage,
        1,
        100,
        25,
        "maxBlocksPerPage",
      ),
    },
    config,
  );
}

function normalizeLinearConfig(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const query = optionalString(config, "query");
  return withRequiredSecretRef(
    {
      apiUrl: normalizeExternalHttpsUrl(
        optionalString(config, "apiUrl") ?? "https://api.linear.app/graphql",
      ),
      ...(query === undefined
        ? {}
        : { query: boundedString(query, 500, "query") }),
      maxItems: boundedInt(config.maxItems, 1, 100, 25, "maxItems"),
    },
    config,
  );
}

function normalizeSlackConfig(
  config: Record<string, unknown>,
): Record<string, unknown> {
  return withRequiredSecretRef(
    {
      apiUrl: normalizeExternalHttpsUrl(
        optionalString(config, "apiUrl") ?? "https://slack.com/api",
      ),
      channelIds: requiredSlackChannelIds(config.channelIds),
      maxItemsPerChannel: boundedInt(
        config.maxItemsPerChannel,
        1,
        100,
        50,
        "maxItemsPerChannel",
      ),
      ...optionalSlackTimestamp(config, "oldest"),
      ...optionalSlackTimestamp(config, "latest"),
    },
    config,
  );
}

function requiredSlackChannelIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) {
    throw new ApiError(
      "invalid_connector_config",
      "Slack connector channelIds must be a non-empty array of at most 50 channel IDs.",
      400,
    );
  }
  const channelIds = value.map((item) => {
    if (typeof item !== "string" || !/^[A-Z0-9]{2,32}$/u.test(item.trim())) {
      throw new ApiError(
        "invalid_connector_config",
        "Slack connector channelIds must contain Slack channel IDs.",
        400,
      );
    }
    return item.trim();
  });
  return [...new Set(channelIds)];
}

function optionalSlackTimestamp(
  config: Record<string, unknown>,
  key: "latest" | "oldest",
): Record<string, unknown> {
  const value = optionalString(config, key);
  if (value === undefined) return {};
  if (!/^\d{10}(?:\.\d{1,6})?$/u.test(value)) {
    throw new ApiError(
      "invalid_connector_config",
      `Slack connector ${key} must be a Slack timestamp.`,
      400,
    );
  }
  return { [key]: value };
}

function normalizeDateVersion(value: string, key: string): string {
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) {
    throw new ApiError(
      "invalid_connector_config",
      `Connector config ${key} must use YYYY-MM-DD format.`,
      400,
    );
  }
  return normalized;
}

function withRequiredSecretRef(
  base: Record<string, unknown>,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const secretRef = requiredString(config, "secretRef");
  assertManagedSecretRef(secretRef);
  return { ...base, secretRef };
}

function withOptionalSourceAccessMode(
  base: Record<string, unknown>,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const mode = optionalString(config, "sourceAccessMode");
  if (mode === undefined || mode === "knowledge_base") return base;
  if (mode !== "connector_owner")
    throw new ApiError(
      "invalid_connector_config",
      "Connector sourceAccessMode is invalid.",
      400,
    );
  return { ...base, sourceAccessMode: mode };
}

function scheduleFields(
  syncIntervalMinutes: number | undefined,
  now: string,
): Pick<DataConnector, "syncIntervalMinutes" | "nextSyncAt"> {
  if (syncIntervalMinutes === undefined) return {};
  return {
    syncIntervalMinutes: normalizeSyncIntervalMinutes(syncIntervalMinutes),
    nextSyncAt: now,
  };
}

function nextScheduleFields(
  connector: DataConnector,
  from: string,
): Pick<DataConnector, "syncIntervalMinutes" | "nextSyncAt"> {
  if (connector.syncIntervalMinutes === undefined) return {};
  return {
    syncIntervalMinutes: connector.syncIntervalMinutes,
    nextSyncAt: new Date(
      new Date(from).getTime() + connector.syncIntervalMinutes * 60_000,
    ).toISOString(),
  };
}

function normalizeSyncIntervalMinutes(value: number): number {
  return boundedInt(value, 5, 43_200, value, "syncIntervalMinutes");
}

function normalizeGitHubConfig(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const repository = requiredString(config, "repository").trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new ApiError(
      "invalid_connector_config",
      "GitHub connector repository must use owner/repo format.",
      400,
    );
  }
  const branch = optionalString(config, "branch") ?? "main";
  if (!isSafeGitHubPathPart(branch))
    throw new ApiError(
      "invalid_connector_config",
      "GitHub connector branch is invalid.",
      400,
    );
  const pathPrefix = normalizePathPrefix(
    optionalString(config, "pathPrefix") ?? "",
  );
  const maxItems = boundedInt(config.maxItems, 1, 100, 50, "maxItems");
  return withOptionalCredentialSource(
    {
      repository,
      branch,
      pathPrefix,
      maxItems,
    },
    config,
  );
}

function normalizeS3Config(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const bucket = requiredString(config, "bucket").trim();
  if (
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) ||
    bucket.includes("..")
  ) {
    throw new ApiError(
      "invalid_connector_config",
      "S3 connector bucket name is invalid.",
      400,
    );
  }
  return withOptionalSecretRef(
    {
      bucket,
      prefix: optionalString(config, "prefix") ?? "",
      region: optionalString(config, "region") ?? "us-east-1",
      maxItems: boundedInt(config.maxItems, 1, 100, 50, "maxItems"),
    },
    config,
  );
}

function withOptionalSecretRef(
  base: Record<string, unknown>,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const secretRef = optionalString(config, "secretRef");
  if (secretRef === undefined) return base;
  assertManagedSecretRef(secretRef);
  return { ...base, secretRef };
}

function withOptionalCredentialSource(
  base: Record<string, unknown>,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const secretRef = optionalString(config, "secretRef");
  const delegatedOAuthConnectionId = optionalString(
    config,
    "delegatedOAuthConnectionId",
  );
  if (secretRef !== undefined && delegatedOAuthConnectionId !== undefined) {
    throw new ApiError(
      "invalid_connector_config",
      "GitHub connector can use secretRef or delegatedOAuthConnectionId, not both.",
      400,
    );
  }
  if (secretRef !== undefined) {
    assertManagedSecretRef(secretRef);
    return { ...base, secretRef };
  }
  if (delegatedOAuthConnectionId !== undefined) {
    if (!/^[A-Za-z0-9_-]{1,160}$/u.test(delegatedOAuthConnectionId)) {
      throw new ApiError(
        "invalid_connector_config",
        "GitHub connector delegatedOAuthConnectionId is invalid.",
        400,
      );
    }
    return { ...base, delegatedOAuthConnectionId };
  }
  return base;
}

function connectorSourceAccessMode(
  config: Record<string, unknown>,
): "connector_owner" | "knowledge_base" {
  return config.sourceAccessMode === "connector_owner"
    ? "connector_owner"
    : "knowledge_base";
}

function connectorSourceMetadata(
  connector: DataConnector,
): Record<string, unknown> {
  if (connectorSourceAccessMode(connector.config) !== "connector_owner")
    return {};
  return {
    sourceAccess: {
      mode: "connector_owner",
      connectorId: connector.id,
      ownerId: connector.createdBy,
    },
  };
}

function requiredString(config: Record<string, unknown>, key: string): string {
  const value = config[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiError(
      "invalid_connector_config",
      `Connector config requires ${key}.`,
      400,
    );
  }
  return value.trim();
}

function optionalString(
  config: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = config[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0)
    throw new ApiError(
      "invalid_connector_config",
      `Connector config ${key} must be a string.`,
      400,
    );
  return value.trim();
}

function boundedInt(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
  key: string,
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
    throw new ApiError(
      "invalid_connector_config",
      `Connector config ${key} must be between ${min} and ${max}.`,
      400,
    );
  }
  return Number(value);
}

function boundedString(value: string, maxLength: number, key: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxLength) {
    throw new ApiError(
      "invalid_connector_config",
      `Connector config ${key} must be between 1 and ${maxLength} characters.`,
      400,
    );
  }
  return normalized;
}

function normalizeApiPath(value: string): string {
  const normalized = value.startsWith("/") ? value : `/${value}`;
  if (
    normalized.length > 180 ||
    normalized.includes("?") ||
    normalized.includes("#") ||
    normalized.split("/").includes("..") ||
    !/^\/[A-Za-z0-9._~/-]+$/u.test(normalized)
  ) {
    throw new ApiError(
      "invalid_connector_config",
      "Connector apiPath is invalid.",
      400,
    );
  }
  return normalized;
}

function normalizePathPrefix(value: string): string {
  const normalized = value.replace(/^\/+|\/+$/gu, "");
  if (normalized.length === 0) return "";
  if (!isSafeGitHubPathPart(normalized))
    throw new ApiError(
      "invalid_connector_config",
      "GitHub connector pathPrefix is invalid.",
      400,
    );
  return normalized;
}

function isSafeGitHubPathPart(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 240 &&
    /^[A-Za-z0-9_./-]+$/u.test(value) &&
    !value.split("/").includes("..")
  );
}

function normalizeExternalHttpsUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ApiError(
      "invalid_connector_url",
      "Connector URL is invalid.",
      400,
    );
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.hash
  ) {
    throw new ApiError(
      "invalid_connector_url",
      "Connector URL must be HTTPS and cannot include credentials or fragments.",
      400,
    );
  }
  const host = parsed.hostname.toLowerCase();
  if (isBlockedHost(host))
    throw new ApiError(
      "private_network_host_blocked",
      "Connector URL cannot target private or local hosts.",
      400,
      { host },
    );
  return parsed.toString();
}

function isBlockedHost(host: string): boolean {
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  )
    return true;
  if (host.includes(":")) return true;
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) return true;
  return false;
}

function connectorSyncErrorMessage(code: string): string {
  if (code === "connector_execution_disabled")
    return "Connector execution is disabled until worker, network, and secret policies are configured.";
  if (code === "connector_egress_allowlist_required")
    return "Connector egress policy requires a host allowlist.";
  if (code === "connector_egress_host_blocked")
    return "Connector host is not in the configured egress allowlist.";
  if (code === "connector_private_network_host_blocked")
    return "Connector host resolves to a private or local network.";
  if (code === "connector_dns_lookup_failed")
    return "Connector host DNS lookup failed.";
  if (code === "connector_sync_items_required")
    return "Local import connector sync requires at least one item.";
  if (code === "connector_delegated_oauth_not_found")
    return "Delegated OAuth connection is unavailable for this connector.";
  if (code === "connector_delegated_oauth_revoked")
    return "Delegated OAuth connection has been revoked.";
  if (code === "connector_delegated_oauth_reauthorization_required")
    return "Delegated OAuth connection requires reauthorization.";
  if (code === "connector_delegated_oauth_expired")
    return "Delegated OAuth connection has expired and requires reauthorization.";
  if (code === "connector_delegated_oauth_refresh_failed")
    return "Delegated OAuth connection refresh failed and requires reauthorization.";
  if (code === "connector_delegated_oauth_unsupported")
    return "Delegated OAuth credential selection is not enabled for this connector executor.";
  return "Connector sync failed.";
}

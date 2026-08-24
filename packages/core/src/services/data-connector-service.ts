import {
  assertScope,
  canAccessOrg,
  hasWorkspaceAccess,
  type AuthSubject,
} from "@romeo/auth";

import { getDataConnectorCatalogEntry } from "../domain/data-connector-catalog";
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
import {
  type AuditAction,
  type AuditMetadata,
  writeAuditLog,
} from "./audit-log";
import {
  disabledCatalogPosture,
  type DataConnectorCatalogReport,
  type DataConnectorCatalogRuntimePosture,
  type DataConnectorPostureReport,
} from "./data-connector-contracts";
import {
  normalizeConnectorConfig,
  scheduleFields,
} from "./data-connector-config";
import { DataConnectorCatalogService } from "./data-connector-catalog-service";
import { runClaimedDataConnectorSync } from "./data-connector-sync-runner";
import { getAuthorizedKnowledgeBase } from "./knowledge-access";
import type { KnowledgeService } from "./knowledge-service";
import { persistedSubjectActorId } from "./subject-persisted-actor";
import { assertWorkspaceActive } from "./workspace-guard";

export type {
  DataConnectorCatalogItem,
  DataConnectorCatalogReport,
  DataConnectorCatalogRuntimePosture,
  DataConnectorPostureReport,
  DataConnectorPostureWarning,
} from "./data-connector-contracts";

export class DataConnectorService {
  private readonly catalogService: DataConnectorCatalogService;

  constructor(
    private readonly repository: RomeoRepository,
    private readonly knowledge: KnowledgeService,
    private readonly executor: DataConnectorExecutor = disabledDataConnectorExecutor,
    catalogPosture: DataConnectorCatalogRuntimePosture = disabledCatalogPosture,
  ) {
    this.catalogService = new DataConnectorCatalogService(
      repository,
      catalogPosture,
    );
  }

  async catalog(subject: AuthSubject): Promise<DataConnectorCatalogReport> {
    return this.catalogService.catalog(subject);
  }

  posture(subject: AuthSubject): Promise<DataConnectorPostureReport> {
    return this.catalogService.postureReport(subject);
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
    this.catalogService.assertCreateReady(catalogEntry);
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

  async sync(input: {
    subject: AuthSubject;
    connectorId: string;
    items?: LocalImportSyncItem[];
  }): Promise<DataConnectorSync> {
    const authorizedConnector = await this.getAuthorizedConnector(
      input.subject,
      input.connectorId,
    );
    await assertWorkspaceActive(this.repository, {
      orgId: input.subject.orgId,
      workspaceId: authorizedConnector.workspaceId,
    });
    await getAuthorizedKnowledgeBase(this.repository, {
      knowledgeBaseId: authorizedConnector.knowledgeBaseId,
      subject: input.subject,
      scope: "knowledge:write",
      permission: "write",
    });
    await assertAbuseControlsAllow(this.repository, input.subject, {
      action: "connector.sync",
      connectorId: authorizedConnector.id,
      workspaceId: authorizedConnector.workspaceId,
      workerClass: "data_connector.sync",
    });
    const createdBy = await persistedSubjectActorId(
      this.repository,
      input.subject,
      {
        kind: "service_account_data_connector_sync",
        name: "Service Account Data Connector Sync Actor",
      },
    );
    const startedAt = new Date().toISOString();
    const leaseToken = createId("connector_sync_lease");
    const connector = await this.repository.claimDataConnectorSync({
      connectorId: authorizedConnector.id,
      leaseExpiresAt: new Date(Date.parse(startedAt) + 300_000).toISOString(),
      leaseOwner: input.subject.id,
      leaseToken,
      now: startedAt,
      orgId: input.subject.orgId,
    });
    if (connector?.syncLease === undefined)
      throw new ApiError(
        "connector_sync_lease_unavailable",
        "The connector is already being synchronized.",
        409,
      );
    return runClaimedDataConnectorSync({
      connector: { ...connector, syncLease: connector.syncLease },
      createdBy,
      executor: this.executor,
      ...(input.items === undefined ? {} : { items: input.items }),
      knowledge: this.knowledge,
      repository: this.repository,
      startedAt,
      subject: input.subject,
    });
  }

  async syncNextDue(input: {
    subject: AuthSubject;
    workerId: string;
    now?: string;
  }): Promise<DataConnectorSync | undefined> {
    assertScope(input.subject, "knowledge:write");
    const startedAt = input.now ?? new Date().toISOString();
    const createdBy = await persistedSubjectActorId(
      this.repository,
      input.subject,
      {
        kind: "service_account_data_connector_sync",
        name: "Service Account Data Connector Sync Actor",
      },
    );
    const connector = await this.repository.claimDataConnectorSync({
      leaseExpiresAt: new Date(Date.parse(startedAt) + 300_000).toISOString(),
      leaseOwner: input.workerId,
      leaseToken: createId("connector_sync_lease"),
      now: startedAt,
      orgId: input.subject.orgId,
    });
    if (connector?.syncLease === undefined) return undefined;
    return runClaimedDataConnectorSync({
      connector: { ...connector, syncLease: connector.syncLease },
      createdBy,
      executor: this.executor,
      knowledge: this.knowledge,
      repository: this.repository,
      startedAt,
      subject: input.subject,
    });
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

  private async audit<A extends AuditAction>(
    subject: AuthSubject,
    action: A,
    resourceId: string,
    outcome: "success" | "failure",
    metadata: AuditMetadata<A>,
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

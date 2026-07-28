import {
  assertScope,
  canAccessOrg,
  hasWorkspaceAccess,
  type AuthSubject,
} from "@romeo/auth";
import type { ContentfulStatusCode } from "hono/utils/http-status";

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
import { writeAuditLog } from "./audit-log";
import {
  disabledCatalogPosture,
  type DataConnectorCatalogReport,
  type DataConnectorCatalogRuntimePosture,
  type DataConnectorPostureReport,
} from "./data-connector-contracts";
import {
  connectorSourceAccessMode,
  connectorSourceMetadata,
  connectorSyncErrorMessage,
  nextScheduleFields,
  normalizeConnectorConfig,
  scheduleFields,
} from "./data-connector-config";
import { DataConnectorCatalogService } from "./data-connector-catalog-service";
import {
  hashContent,
  localImportCursor,
  type LocalImportCursorEntry,
} from "./data-connector-local-import";
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

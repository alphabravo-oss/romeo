import type { AuthSubject } from "@romeo/auth";

import type {
  DataConnector,
  DataConnectorSync,
  LocalImportSyncItem,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { createId } from "../ids";
import { assertAbuseControlsAllow } from "./abuse-control-service";
import { writeAuditLog } from "./audit-log";
import {
  connectorSourceAccessMode,
  connectorSourceMetadata,
  nextScheduleFields,
} from "./data-connector-config";
import type { DataConnectorExecutor } from "./data-connector-executors";
import {
  hashContent,
  localImportCursor,
  type LocalImportCursorEntry,
} from "./data-connector-local-import";
import { failDataConnectorSync } from "./data-connector-sync-failure";
import { startDataConnectorSyncHeartbeat } from "./data-connector-sync-lease";
import { getAuthorizedKnowledgeBase } from "./knowledge-access";
import type { KnowledgeService } from "./knowledge-service";
import { assertWorkspaceActive } from "./workspace-guard";

export async function runClaimedDataConnectorSync(input: {
  connector: DataConnector & {
    syncLease: NonNullable<DataConnector["syncLease"]>;
  };
  createdBy: string;
  executor: DataConnectorExecutor;
  items?: LocalImportSyncItem[];
  knowledge: KnowledgeService;
  repository: RomeoRepository;
  startedAt: string;
  subject: AuthSubject;
}): Promise<DataConnectorSync> {
  const { connector } = input;
  const previousSync = await latestCompletedSync(input.repository, connector);
  const sync = await input.repository.createDataConnectorSync({
    id: createId("connector_sync"),
    orgId: connector.orgId,
    workspaceId: connector.workspaceId,
    knowledgeBaseId: connector.knowledgeBaseId,
    connectorId: connector.id,
    status: "running",
    createdBy: input.createdBy,
    itemCount: input.items?.length ?? 0,
    sourceIds: [],
    summary: { connectorType: connector.type },
    startedAt: input.startedAt,
    fencingToken: connector.syncLease.fencingToken,
    leaseToken: connector.syncLease.token,
  });
  const heartbeat = startDataConnectorSyncHeartbeat(
    input.repository,
    connector,
  );

  try {
    await validateClaimedSync(input);
    const execution = await resolveSyncItems(
      input.executor,
      connector,
      input.items,
    );
    const sourceIds: string[] = [];
    const previousCursor = localImportCursor(connector.config);
    const nextCursor: LocalImportCursorEntry[] = [];
    let createdSourceCount = 0;
    let reusedSourceCount = 0;
    for (const item of execution.items) {
      heartbeat.assertOwned();
      const contentHash = hashContent(item.content);
      const previous = previousCursor.find(
        (entry) =>
          entry.fileName === item.fileName && entry.contentHash === contentHash,
      );
      if (
        previous !== undefined &&
        (await sourceExists(
          input.repository,
          connector.knowledgeBaseId,
          previous.sourceId,
        ))
      ) {
        sourceIds.push(previous.sourceId);
        nextCursor.push(previous);
        reusedSourceCount += 1;
        continue;
      }
      const source = await input.knowledge.createSource({
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
    const deletedSourceIds = await deleteSupersededSources({
      connector,
      currentSourceIds: sourceIds,
      knowledge: input.knowledge,
      previousSourceIds: previousSync?.sourceIds ?? [],
      repository: input.repository,
      subject: input.subject,
    });
    const completedAt = new Date().toISOString();
    await heartbeat.stop();
    return input.repository.transaction(async (repository) => {
      const saved = await repository.finishDataConnectorSync({
        connector: {
          ...connector,
          config: { ...connector.config, lastCursor: nextCursor },
          ...nextScheduleFields(connector, completedAt),
          lastSyncAt: completedAt,
          updatedAt: completedAt,
        },
        fencingToken: connector.syncLease.fencingToken,
        leaseOwner: connector.syncLease.owner,
        leaseToken: connector.syncLease.token,
        now: completedAt,
        sync: {
          ...sync,
          status: "completed",
          itemCount: execution.items.length,
          sourceIds,
          summary: {
            connectorType: connector.type,
            ...execution.summary,
            sourceAccessMode: connectorSourceAccessMode(connector.config),
            sourceCount: sourceIds.length,
            createdSourceCount,
            reusedSourceCount,
            deletedSourceCount: deletedSourceIds.length,
            deletedSourceIds,
          },
          completedAt,
        },
      });
      if (saved === undefined) throw leaseLost();
      await writeAuditLog(repository, {
        subject: input.subject,
        action: "data_connector.sync",
        resourceType: "data_connector",
        resourceId: connector.id,
        outcome: "success",
        metadata: {
          syncId: saved.id,
          sourceCount: sourceIds.length,
          createdSourceCount,
          reusedSourceCount,
          deletedSourceCount: deletedSourceIds.length,
        },
      });
      return saved;
    });
  } catch (error) {
    await heartbeat.stop({ requireOwned: false });
    return failDataConnectorSync({
      connector,
      errorCode:
        error instanceof ApiError ? error.code : "connector_sync_failed",
      repository: input.repository,
      statusCode: error instanceof ApiError ? error.status : 500,
      subject: input.subject,
      sync,
    });
  }
}

async function validateClaimedSync(
  input: Parameters<typeof runClaimedDataConnectorSync>[0],
): Promise<void> {
  await assertWorkspaceActive(input.repository, {
    orgId: input.subject.orgId,
    workspaceId: input.connector.workspaceId,
  });
  await getAuthorizedKnowledgeBase(input.repository, {
    knowledgeBaseId: input.connector.knowledgeBaseId,
    subject: input.subject,
    scope: "knowledge:write",
    permission: "write",
  });
  await assertAbuseControlsAllow(input.repository, input.subject, {
    action: "connector.sync",
    connectorId: input.connector.id,
    workspaceId: input.connector.workspaceId,
    workerClass: "data_connector.sync",
  });
}

async function latestCompletedSync(
  repository: RomeoRepository,
  connector: DataConnector,
): Promise<DataConnectorSync | undefined> {
  return (
    await repository.listDataConnectorSyncs(connector.orgId, connector.id)
  ).find((sync) => sync.status === "completed");
}

async function sourceExists(
  repository: RomeoRepository,
  knowledgeBaseId: string,
  sourceId: string,
): Promise<boolean> {
  return (await repository.listKnowledgeSources(knowledgeBaseId)).some(
    (source) => source.id === sourceId,
  );
}

async function resolveSyncItems(
  executor: DataConnectorExecutor,
  connector: DataConnector,
  items: LocalImportSyncItem[] | undefined,
) {
  if (connector.type === "local_import") {
    if (!items || items.length === 0)
      throw new ApiError(
        "connector_sync_items_required",
        "Local import connector sync requires at least one item.",
        400,
      );
    return { items };
  }
  if (items !== undefined)
    throw new ApiError(
      "connector_sync_items_unsupported",
      "Managed connector sync does not accept inline items.",
      400,
    );
  return executor.sync(connector);
}

async function deleteSupersededSources(input: {
  connector: DataConnector;
  currentSourceIds: string[];
  knowledge: KnowledgeService;
  previousSourceIds: string[];
  repository: RomeoRepository;
  subject: AuthSubject;
}): Promise<string[]> {
  const current = new Set(input.currentSourceIds);
  const existing = new Set(
    (
      await input.repository.listKnowledgeSources(
        input.connector.knowledgeBaseId,
      )
    ).map((source) => source.id),
  );
  const deleted: string[] = [];
  for (const sourceId of input.previousSourceIds) {
    if (current.has(sourceId) || !existing.has(sourceId)) continue;
    await input.knowledge.deleteSource({
      subject: input.subject,
      knowledgeBaseId: input.connector.knowledgeBaseId,
      sourceId,
    });
    deleted.push(sourceId);
  }
  return deleted;
}

function leaseLost(): ApiError {
  return new ApiError(
    "connector_sync_lease_lost",
    "The connector synchronization lease was lost before completion.",
    409,
  );
}

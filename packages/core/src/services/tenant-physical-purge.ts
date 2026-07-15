import type { ObjectStore } from "@romeo/storage";

import type { BackgroundJob, MessagePart } from "../domain/entities";
import type {
  TenantDataPurgeResult,
  RomeoRepository,
} from "../domain/repository";
import { ApiError } from "../errors";
import { listRegisteredDataExportPackages } from "./data-export-package-registry";
import { isToolDispatchPayloadStoreReference } from "./tool-dispatch-payload-store";
import { readActiveVoiceArtifactUsageMetadata } from "./voice-artifact-metadata";
import { readBrowserAutomationStoredArtifacts } from "./workflow-browser-tasks";

export interface TenantPhysicalPurgeResult {
  schema: "romeo.tenant-physical-purge-result.v1";
  orgId: string;
  status: "deleted";
  deletedAt: string;
  deletedBy: string;
  database: TenantDataPurgeResult & {
    totalRecordCount: number;
  };
  objectStore: {
    deletionFailures: 0;
    objectStoreKeysReturned: false;
    trackedObjectCount: number;
    deletedObjectCount: number;
    trackedObjectsByClass: Record<TenantTrackedObjectClass, number>;
  };
  externalEvidence: {
    backupsHandledByEvidence: true;
    externalSecretsHandledByEvidence: true;
    externalVectorsHandledByEvidence: true;
    operationalLogsHandledByEvidence: true;
    supportBundlesHandledByEvidence: true;
  };
  redaction: {
    auditLogBodiesReturned: false;
    evidenceBodiesReturned: false;
    objectStoreKeysReturned: false;
    rawEvidenceRefsReturned: false;
    secretValuesReturned: false;
    vectorValuesReturned: false;
  };
}

export type TenantTrackedObjectClass =
  | "browser_automation_artifact"
  | "chat_attachment"
  | "data_export_package"
  | "file_object"
  | "knowledge_source"
  | "tool_dispatch_payload"
  | "voice_artifact";

interface TenantPurgeObjectManifest {
  keys: string[];
  trackedObjectsByClass: Record<TenantTrackedObjectClass, number>;
}

export async function executeTenantPhysicalPurge(input: {
  deletedBy: string;
  objectStore: ObjectStore;
  orgId: string;
  repository: RomeoRepository;
}): Promise<TenantPhysicalPurgeResult> {
  const manifest = await collectTenantPurgeObjectManifest({
    orgId: input.orgId,
    repository: input.repository,
  });
  await deleteTenantObjectKeys(input.objectStore, manifest.keys);
  const database = await input.repository.purgeTenantData(input.orgId);
  const deletedAt = new Date().toISOString();
  const result: TenantPhysicalPurgeResult = {
    schema: "romeo.tenant-physical-purge-result.v1",
    orgId: input.orgId,
    status: "deleted",
    deletedAt,
    deletedBy: input.deletedBy,
    database: {
      ...database,
      totalRecordCount: Object.values(database.recordCounts).reduce(
        (total, value) => total + value,
        0,
      ),
    },
    objectStore: {
      deletionFailures: 0,
      deletedObjectCount: manifest.keys.length,
      objectStoreKeysReturned: false,
      trackedObjectCount: manifest.keys.length,
      trackedObjectsByClass: manifest.trackedObjectsByClass,
    },
    externalEvidence: {
      backupsHandledByEvidence: true,
      externalSecretsHandledByEvidence: true,
      externalVectorsHandledByEvidence: true,
      operationalLogsHandledByEvidence: true,
      supportBundlesHandledByEvidence: true,
    },
    redaction: {
      auditLogBodiesReturned: false,
      evidenceBodiesReturned: false,
      objectStoreKeysReturned: false,
      rawEvidenceRefsReturned: false,
      secretValuesReturned: false,
      vectorValuesReturned: false,
    },
  };
  await input.repository.upsertSystemSetting({
    key: tenantPhysicalPurgeResultKey(input.orgId),
    updatedAt: deletedAt,
    value: result as unknown as Record<string, unknown>,
  });
  return result;
}

export function tenantPhysicalPurgeResultKey(orgId: string): string {
  return `tenant_lifecycle.deletion_purge_result.v1:${orgId}`;
}

async function collectTenantPurgeObjectManifest(input: {
  orgId: string;
  repository: RomeoRepository;
}): Promise<TenantPurgeObjectManifest> {
  const trackedObjectsByClass = emptyTrackedObjectsByClass();
  const keysByClass = new Map<TenantTrackedObjectClass, Set<string>>();
  const add = (objectClass: TenantTrackedObjectClass, key?: string): void => {
    if (key === undefined || key.trim().length === 0) return;
    let keys = keysByClass.get(objectClass);
    if (keys === undefined) {
      keys = new Set();
      keysByClass.set(objectClass, keys);
    }
    keys.add(key);
  };

  const [files, packages, jobs, usageEvents, workspaces] = await Promise.all([
    input.repository.listFileObjects(input.orgId),
    listRegisteredDataExportPackages(input),
    input.repository.listBackgroundJobs(input.orgId),
    input.repository.listUsageEvents(input.orgId),
    input.repository.listWorkspaces(input.orgId),
  ]);

  for (const file of files) add("file_object", file.objectKey);
  for (const item of packages.packages) {
    add(
      "data_export_package",
      dataExportPackageObjectKey(input.orgId, item.packageId),
    );
  }
  for (const job of jobs) collectBackgroundJobObjectKeys(job, add);
  for (const event of usageEvents) {
    add(
      "voice_artifact",
      readActiveVoiceArtifactUsageMetadata(event)?.storageKey,
    );
  }
  for (const workspace of workspaces) {
    await collectWorkspaceObjectKeys(input.repository, workspace.id, add);
    const knowledgeBases = await input.repository.listKnowledgeBases(
      workspace.id,
    );
    for (const knowledgeBase of knowledgeBases) {
      const sources = await input.repository.listKnowledgeSources(
        knowledgeBase.id,
      );
      for (const source of sources) add("knowledge_source", source.objectKey);
    }
  }

  for (const [objectClass, keys] of keysByClass.entries()) {
    trackedObjectsByClass[objectClass] = keys.size;
  }

  return {
    keys: [...new Set([...keysByClass.values()].flatMap((keys) => [...keys]))],
    trackedObjectsByClass,
  };
}

async function collectWorkspaceObjectKeys(
  repository: RomeoRepository,
  workspaceId: string,
  add: (objectClass: TenantTrackedObjectClass, key?: string) => void,
): Promise<void> {
  const chats = await repository.listChats(workspaceId);
  for (const chat of chats) {
    const messages = await repository.listMessages(chat.id);
    for (const message of messages) {
      const parts = await repository.listMessageParts(message.id);
      for (const part of parts) addMessagePartObjectKey(part, add);
    }
  }
}

function addMessagePartObjectKey(
  part: MessagePart,
  add: (objectClass: TenantTrackedObjectClass, key?: string) => void,
): void {
  if (part.type === "attachment") add("chat_attachment", part.content);
}

function collectBackgroundJobObjectKeys(
  job: BackgroundJob,
  add: (objectClass: TenantTrackedObjectClass, key?: string) => void,
): void {
  for (const artifact of readBrowserAutomationStoredArtifacts(job)) {
    add("browser_automation_artifact", artifact.storageKey);
  }
  collectToolDispatchPayloadObjectKeys(job.payload, add);
}

function collectToolDispatchPayloadObjectKeys(
  value: unknown,
  add: (objectClass: TenantTrackedObjectClass, key?: string) => void,
): void {
  if (isToolDispatchPayloadStoreReference(value)) {
    add("tool_dispatch_payload", value.objectKey);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectToolDispatchPayloadObjectKeys(item, add);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const child of Object.values(value)) {
    collectToolDispatchPayloadObjectKeys(child, add);
  }
}

async function deleteTenantObjectKeys(
  objectStore: ObjectStore,
  objectKeys: string[],
): Promise<void> {
  try {
    for (const objectKey of objectKeys) {
      await objectStore.deleteObject(objectKey);
    }
  } catch {
    throw new ApiError(
      "tenant_purge_object_store_unavailable",
      "Object storage is not available for final tenant deletion.",
      503,
      {
        objectStoreKeysReturned: false,
      },
    );
  }
}

function emptyTrackedObjectsByClass(): Record<
  TenantTrackedObjectClass,
  number
> {
  return {
    browser_automation_artifact: 0,
    chat_attachment: 0,
    data_export_package: 0,
    file_object: 0,
    knowledge_source: 0,
    tool_dispatch_payload: 0,
    voice_artifact: 0,
  };
}

function dataExportPackageObjectKey(orgId: string, packageId: string): string {
  return `governance/data-exports/${encodePathPart(orgId)}/${encodePathPart(
    packageId,
  )}.json`;
}

function encodePathPart(value: string): string {
  return encodeURIComponent(value).replace(/%2F/giu, "%252F");
}

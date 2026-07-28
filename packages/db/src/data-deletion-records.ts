export type DataDeletionResourceTypeRecord =
  | "chat"
  | "file_object"
  | "knowledge_source";

export interface DataDeletionCountsRecord {
  chats: number;
  messages: number;
  messageParts: number;
  runs: number;
  runSteps: number;
  runEvents: number;
  chatComments: number;
  userNotifications: number;
  notificationDeliveries: number;
  runLinkedToolCalls: number;
  usageEvents: number;
  resourceGrants: number;
  resourceFavorites: number;
  workspaceFolderItems: number;
  fileObjects: number;
  knowledgeSources: number;
  knowledgeChunks: number;
  knowledgeEmbeddings: number;
  objectStoreObjects: number;
  objectStoreBytes: number;
}

export interface DataDeletionPlanRecord {
  orgId: string;
  workspaceId: string;
  resourceType: DataDeletionResourceTypeRecord;
  resourceId: string;
  knowledgeBaseId?: string;
  legalHold?: {
    until: string;
    reason?: string;
  };
  counts: DataDeletionCountsRecord;
}

export function emptyDataDeletionCounts(): DataDeletionCountsRecord {
  return {
    chats: 0,
    messages: 0,
    messageParts: 0,
    runs: 0,
    runSteps: 0,
    runEvents: 0,
    chatComments: 0,
    userNotifications: 0,
    notificationDeliveries: 0,
    runLinkedToolCalls: 0,
    usageEvents: 0,
    resourceGrants: 0,
    resourceFavorites: 0,
    workspaceFolderItems: 0,
    fileObjects: 0,
    knowledgeSources: 0,
    knowledgeChunks: 0,
    knowledgeEmbeddings: 0,
    objectStoreObjects: 0,
    objectStoreBytes: 0,
  };
}

export function fileObjectStorageObjectCount(metadata: unknown): number {
  if (!isJsonObject(metadata)) return 1;
  if (metadata.uploadMode !== "resumable_backend_composed") return 1;
  const partCount = metadata.partCount;
  return typeof partCount === "number" &&
    Number.isInteger(partCount) &&
    partCount > 0
    ? partCount + 1
    : 1;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

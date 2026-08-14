import type * as E from "../domain/entities";
import type { RunEvent } from "@romeo/ai-runtime";
import type { SeedData } from "./seed-data";
import { reconcileFileReferencesInMemory } from "./in-memory-message-file-references";

export function deleteChatDataInMemory(input: {
  data: SeedData;
  chatId: string;
  messageIds: Set<string>;
  notificationIds: Set<string>;
  orgId: string;
  runEvents: Map<string, RunEvent[]>;
  runIds: Set<string>;
}): void {
  const { data, chatId, messageIds, notificationIds, orgId, runEvents, runIds } = input;
  const referencedFileIds = [
    ...new Set(
      data.messageFileReferences
        .filter((reference) => messageIds.has(reference.messageId))
        .map((reference) => reference.fileId),
    ),
  ];
  data.messageFileReferences = data.messageFileReferences.filter(
    (reference) => !messageIds.has(reference.messageId),
  );
  data.messageParts = data.messageParts.filter(
    (part) => !messageIds.has(part.messageId),
  );
  data.messages = data.messages.filter((message) => message.chatId !== chatId);
  reconcileFileReferencesInMemory(data, referencedFileIds, new Date().toISOString());
  data.chats = data.chats.filter(
    (chat) => !(chat.orgId === orgId && chat.id === chatId),
  );
  data.queuedChatTurns = data.queuedChatTurns.filter(
    (turn) => !(turn.orgId === orgId && turn.chatId === chatId),
  );
  data.runs = data.runs.filter(
    (run) => !(run.orgId === orgId && run.chatId === chatId),
  );
  data.chatComments = data.chatComments.filter(
    (comment) => !(comment.orgId === orgId && comment.chatId === chatId),
  );
  data.chatTagAssignments = data.chatTagAssignments.filter(
    (assignment) => !(assignment.orgId === orgId && assignment.chatId === chatId),
  );
  data.userNotifications = data.userNotifications.filter(
    (notification) => !notificationIds.has(notification.id),
  );
  data.notificationDeliveries = data.notificationDeliveries.filter(
    (delivery) => !notificationIds.has(delivery.notificationId),
  );
  data.toolCalls = data.toolCalls.filter(
    (call) => call.runId === undefined || !runIds.has(call.runId),
  );
  data.usageEvents = data.usageEvents.filter(
    (event) => !isChatDeletionUsageEvent(event, runIds, messageIds, chatId),
  );
  data.grants = data.grants.filter(
    (grant) => !(grant.resourceType === "chat" && grant.resourceId === chatId),
  );
  data.resourceFavorites = data.resourceFavorites.filter(
    (favorite) =>
      !(favorite.orgId === orgId && favorite.resourceType === "chat" && favorite.resourceId === chatId),
  );
  data.workspaceFolderItems = data.workspaceFolderItems.filter(
    (item) =>
      !(item.orgId === orgId && item.resourceType === "chat" && item.resourceId === chatId),
  );
  for (const runId of runIds) runEvents.delete(runId);
}

export function isChatDeletionUsageEvent(
  event: E.UsageEvent,
  runIds: Set<string>,
  messageIds: Set<string>,
  chatId: string,
): boolean {
  if (event.sourceType === "run" && runIds.has(event.sourceId)) return true;
  if (event.sourceType !== "voice") return false;
  return (
    event.metadata.chatId === chatId ||
    (typeof event.metadata.messageId === "string" &&
      messageIds.has(event.metadata.messageId))
  );
}

export function emptyDataDeletionCounts(): E.DataDeletionPlan["counts"] {
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

export function fileObjectStorageObjectCount(
  metadata: Record<string, unknown>,
): number {
  if (metadata.uploadMode !== "resumable_backend_composed") return 1;
  const partCount = metadata.partCount;
  return typeof partCount === "number" &&
    Number.isInteger(partCount) &&
    partCount > 0
    ? partCount + 1
    : 1;
}

export function activeLegalHold(
  chat: E.Chat,
): E.DataDeletionPlan["legalHold"] | undefined {
  if (chat.legalHoldUntil === undefined) return undefined;
  if (new Date(chat.legalHoldUntil).getTime() <= Date.now()) return undefined;
  return {
    until: chat.legalHoldUntil,
    ...(chat.legalHoldReason !== undefined
      ? { reason: chat.legalHoldReason }
      : {}),
  };
}

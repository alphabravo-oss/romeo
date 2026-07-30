import type * as Ai from "@romeo/ai-runtime";

import type * as E from "../domain/entities";
import type * as R from "../domain/repository";
import { append, appendMany, replaceById } from "./collection-helpers";
import { fileTombstoneFields } from "../domain/file-tombstone";
import { InMemoryContentRepository } from "./in-memory-content";

export abstract class InMemoryRunRepository extends InMemoryContentRepository {
  async createRun(run: E.RunRecord): Promise<E.RunRecord> {
    return append(this.data.runs, run);
  }

  async getRun(runId: string): Promise<E.RunRecord | undefined> {
    return this.data.runs.find((run) => run.id === runId);
  }

  async listRuns(chatId: string): Promise<E.RunRecord[]> {
    return this.data.runs
      .filter((run) => run.chatId === chatId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async updateRun(run: E.RunRecord): Promise<E.RunRecord> {
    return replaceById(this.data.runs, run);
  }

  async finalizeRun(
    input: R.FinalizeRunInput,
  ): Promise<E.RunRecord | undefined> {
    const run = this.data.runs.find(
      (candidate) => candidate.id === input.runId,
    );
    if (
      run === undefined ||
      run.status === "cancelled" ||
      run.status === "completed" ||
      run.status === "failed"
    )
      return undefined;
    return replaceById(this.data.runs, {
      ...run,
      status: input.status,
      completedAt: input.completedAt,
    });
  }

  async appendRunEvents(events: Ai.RunEvent[]): Promise<void> {
    for (const event of events) {
      const existing = this.runEvents.get(event.runId) ?? [];
      existing.push(event);
      this.runEvents.set(event.runId, existing);
    }
  }

  async listRunEvents(runId: string): Promise<Ai.RunEvent[]> {
    return this.runEvents.get(runId) ?? [];
  }

  async listToolCalls(orgId: string): Promise<E.ToolCallRecord[]> {
    return this.data.toolCalls
      .filter((call) => call.orgId === orgId)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  async createToolCall(call: E.ToolCallRecord): Promise<E.ToolCallRecord> {
    return append(this.data.toolCalls, call);
  }

  async listToolConnectors(orgId: string): Promise<E.ToolConnector[]> {
    return this.data.toolConnectors.filter(
      (connector) => connector.orgId === orgId,
    );
  }

  async createToolConnector(
    connector: E.ToolConnector,
  ): Promise<E.ToolConnector> {
    return append(this.data.toolConnectors, connector);
  }

  async updateToolConnector(
    connector: E.ToolConnector,
  ): Promise<E.ToolConnector> {
    return replaceById(this.data.toolConnectors, connector);
  }

  async listToolOperations(connectorId: string): Promise<E.ToolOperation[]> {
    return this.data.toolOperations.filter(
      (operation) => operation.connectorId === connectorId,
    );
  }

  async listToolOperationsForConnectors(
    connectorIds: string[],
  ): Promise<E.ToolOperation[]> {
    const requested = new Set(connectorIds);
    return this.data.toolOperations.filter((operation) =>
      requested.has(operation.connectorId),
    );
  }

  async createToolOperations(
    operations: E.ToolOperation[],
  ): Promise<E.ToolOperation[]> {
    return appendMany(this.data.toolOperations, operations);
  }

  async updateToolOperation(
    operation: E.ToolOperation,
  ): Promise<E.ToolOperation> {
    return replaceById(this.data.toolOperations, operation);
  }

  async listAuditLogs(orgId: string): Promise<E.AuditLog[]> {
    return this.data.auditLogs
      .filter((log) => log.orgId === orgId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async createAuditLog(log: E.AuditLog): Promise<E.AuditLog> {
    return append(this.data.auditLogs, log);
  }

  async deleteAuditLogsBefore(orgId: string, before: string): Promise<number> {
    const initialCount = this.data.auditLogs.length;
    this.data.auditLogs = this.data.auditLogs.filter(
      (log) => log.orgId !== orgId || log.createdAt >= before,
    );
    return initialCount - this.data.auditLogs.length;
  }

  async getDataDeletionPlan(
    orgId: string,
    resourceType: E.DataDeletionResourceType,
    resourceId: string,
  ): Promise<E.DataDeletionPlan | undefined> {
    if (resourceType === "chat")
      return this.chatDeletionPlan(orgId, resourceId);
    if (resourceType === "file_object")
      return this.fileObjectDeletionPlan(orgId, resourceId);
    if (resourceType === "knowledge_source")
      return this.knowledgeSourceDeletionPlan(orgId, resourceId);
    return undefined;
  }

  async deleteDataForResource(
    orgId: string,
    resourceType: E.DataDeletionResourceType,
    resourceId: string,
  ): Promise<E.DataDeletionPlan | undefined> {
    if (resourceType === "file_object")
      return this.deleteFileObjectForDataDeletion(orgId, resourceId);
    if (resourceType === "knowledge_source") return undefined;
    if (resourceType !== "chat") return undefined;

    const plan = await this.getDataDeletionPlan(
      orgId,
      resourceType,
      resourceId,
    );
    if (!plan) return undefined;

    const runIds = new Set(
      this.data.runs
        .filter((run) => run.orgId === orgId && run.chatId === resourceId)
        .map((run) => run.id),
    );
    const messageIds = new Set(
      this.data.messages
        .filter((message) => message.chatId === resourceId)
        .map((message) => message.id),
    );
    const notificationIds = new Set(
      this.data.userNotifications
        .filter(
          (notification) =>
            notification.orgId === orgId &&
            notification.resourceType === "chat" &&
            notification.resourceId === resourceId,
        )
        .map((notification) => notification.id),
    );

    this.data.messageParts = this.data.messageParts.filter(
      (part) => !messageIds.has(part.messageId),
    );
    this.data.chats = this.data.chats.filter(
      (chat) => !(chat.orgId === orgId && chat.id === resourceId),
    );
    this.data.messages = this.data.messages.filter(
      (message) => message.chatId !== resourceId,
    );
    this.data.queuedChatTurns = this.data.queuedChatTurns.filter(
      (turn) => !(turn.orgId === orgId && turn.chatId === resourceId),
    );
    this.data.runs = this.data.runs.filter(
      (run) => !(run.orgId === orgId && run.chatId === resourceId),
    );
    this.data.chatComments = this.data.chatComments.filter(
      (comment) => !(comment.orgId === orgId && comment.chatId === resourceId),
    );
    this.data.chatTagAssignments = this.data.chatTagAssignments.filter(
      (assignment) =>
        !(assignment.orgId === orgId && assignment.chatId === resourceId),
    );
    this.data.userNotifications = this.data.userNotifications.filter(
      (notification) => !notificationIds.has(notification.id),
    );
    this.data.notificationDeliveries = this.data.notificationDeliveries.filter(
      (delivery) => !notificationIds.has(delivery.notificationId),
    );
    this.data.toolCalls = this.data.toolCalls.filter(
      (call) => call.runId === undefined || !runIds.has(call.runId),
    );
    this.data.usageEvents = this.data.usageEvents.filter(
      (event) =>
        !isChatDeletionUsageEvent(event, runIds, messageIds, resourceId),
    );
    this.data.grants = this.data.grants.filter(
      (grant) =>
        !(grant.resourceType === "chat" && grant.resourceId === resourceId),
    );
    this.data.resourceFavorites = this.data.resourceFavorites.filter(
      (favorite) =>
        !(
          favorite.orgId === orgId &&
          favorite.resourceType === "chat" &&
          favorite.resourceId === resourceId
        ),
    );
    this.data.workspaceFolderItems = this.data.workspaceFolderItems.filter(
      (item) =>
        !(
          item.orgId === orgId &&
          item.resourceType === "chat" &&
          item.resourceId === resourceId
        ),
    );
    for (const runId of runIds) this.runEvents.delete(runId);

    return plan;
  }

  private chatDeletionPlan(
    orgId: string,
    chatId: string,
  ): E.DataDeletionPlan | undefined {
    const chat = this.data.chats.find(
      (item) => item.orgId === orgId && item.id === chatId,
    );
    if (!chat) return undefined;

    const runIds = new Set(
      this.data.runs
        .filter((run) => run.orgId === orgId && run.chatId === chatId)
        .map((run) => run.id),
    );
    const messageIds = new Set(
      this.data.messages
        .filter((message) => message.chatId === chatId)
        .map((message) => message.id),
    );
    const notificationIds = new Set(
      this.data.userNotifications
        .filter(
          (notification) =>
            notification.orgId === orgId &&
            notification.resourceType === "chat" &&
            notification.resourceId === chatId,
        )
        .map((notification) => notification.id),
    );

    const legalHold = activeLegalHold(chat);
    return {
      orgId,
      workspaceId: chat.workspaceId,
      resourceType: "chat",
      resourceId: chat.id,
      ...(legalHold !== undefined ? { legalHold } : {}),
      counts: {
        ...emptyDataDeletionCounts(),
        chats: 1,
        messages: messageIds.size,
        messageParts: this.data.messageParts.filter((part) =>
          messageIds.has(part.messageId),
        ).length,
        runs: runIds.size,
        runSteps: 0,
        runEvents: Array.from(runIds).reduce(
          (count, runId) => count + (this.runEvents.get(runId)?.length ?? 0),
          0,
        ),
        chatComments: this.data.chatComments.filter(
          (comment) => comment.orgId === orgId && comment.chatId === chatId,
        ).length,
        userNotifications: notificationIds.size,
        notificationDeliveries: this.data.notificationDeliveries.filter(
          (delivery) => notificationIds.has(delivery.notificationId),
        ).length,
        runLinkedToolCalls: this.data.toolCalls.filter(
          (call) => call.runId !== undefined && runIds.has(call.runId),
        ).length,
        usageEvents: this.data.usageEvents.filter((event) =>
          isChatDeletionUsageEvent(event, runIds, messageIds, chatId),
        ).length,
        resourceGrants: this.data.grants.filter(
          (grant) =>
            grant.resourceType === "chat" && grant.resourceId === chatId,
        ).length,
        resourceFavorites: this.data.resourceFavorites.filter(
          (favorite) =>
            favorite.orgId === orgId &&
            favorite.resourceType === "chat" &&
            favorite.resourceId === chatId,
        ).length,
        workspaceFolderItems: this.data.workspaceFolderItems.filter(
          (item) =>
            item.orgId === orgId &&
            item.resourceType === "chat" &&
            item.resourceId === chatId,
        ).length,
      },
    };
  }

  private fileObjectDeletionPlan(
    orgId: string,
    fileId: string,
  ): E.DataDeletionPlan | undefined {
    const file = this.data.fileObjects.find(
      (item) =>
        item.orgId === orgId && item.id === fileId && item.status !== "deleted",
    );
    if (file === undefined) return undefined;
    return {
      orgId,
      workspaceId: file.workspaceId,
      resourceType: "file_object",
      resourceId: file.id,
      counts: {
        ...emptyDataDeletionCounts(),
        resourceGrants: this.data.grants.filter(
          (grant) =>
            grant.resourceType === "file" && grant.resourceId === file.id,
        ).length,
        fileObjects: 1,
        objectStoreObjects: fileObjectStorageObjectCount(file.metadata),
        objectStoreBytes: file.sizeBytes,
      },
    };
  }

  private async deleteFileObjectForDataDeletion(
    orgId: string,
    fileId: string,
  ): Promise<E.DataDeletionPlan | undefined> {
    const plan = this.fileObjectDeletionPlan(orgId, fileId);
    if (plan === undefined) return undefined;
    const now = new Date().toISOString();
    this.data.fileObjects = this.data.fileObjects.map((file) =>
      file.orgId === orgId && file.id === fileId
        ? {
            ...file,
            ...fileTombstoneFields(file.id, now),
          }
        : file,
    );
    this.data.grants = this.data.grants.filter(
      (grant) =>
        !(grant.resourceType === "file" && grant.resourceId === fileId),
    );
    return plan;
  }

  private knowledgeSourceDeletionPlan(
    orgId: string,
    sourceId: string,
  ): E.DataDeletionPlan | undefined {
    const source = this.data.knowledgeSources.find(
      (item) => item.orgId === orgId && item.id === sourceId,
    );
    if (source === undefined) return undefined;
    return {
      orgId,
      workspaceId: source.workspaceId,
      resourceType: "knowledge_source",
      resourceId: source.id,
      knowledgeBaseId: source.knowledgeBaseId,
      counts: {
        ...emptyDataDeletionCounts(),
        knowledgeSources: 1,
        knowledgeChunks: this.data.knowledgeChunks.filter(
          (chunk) => chunk.sourceId === source.id,
        ).length,
        knowledgeEmbeddings: this.data.knowledgeChunkEmbeddings.filter(
          (embedding) => embedding.sourceId === source.id,
        ).length,
        objectStoreObjects: source.objectKey === undefined ? 0 : 1,
        objectStoreBytes: source.objectKey === undefined ? 0 : source.sizeBytes,
      },
    };
  }
}

function isChatDeletionUsageEvent(
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

function emptyDataDeletionCounts(): E.DataDeletionPlan["counts"] {
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

function fileObjectStorageObjectCount(
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

function activeLegalHold(
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

import type * as Ai from "@romeo/ai-runtime";

import type * as E from "../domain/entities";
import type * as R from "../domain/repository";
import { append, appendMany, replaceById } from "./collection-helpers";
import { fileTombstoneFields } from "../domain/file-tombstone";
import { InMemoryAuditRepository } from "./in-memory-audit";
import {
  activeLegalHold,
  deleteChatDataInMemory,
  emptyDataDeletionCounts,
  fileObjectStorageObjectCount,
  isChatDeletionUsageEvent,
} from "./in-memory-data-deletion-helpers";

export abstract class InMemoryRunRepository extends InMemoryAuditRepository {
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
      this.runEventSequences.set(
        event.runId,
        Math.max(this.runEventSequences.get(event.runId) ?? 0, event.sequence),
      );
    }
  }

  async allocateRunEventSequence(runId: string): Promise<number | undefined> {
    if (!this.data.runs.some((run) => run.id === runId)) return undefined;
    const current =
      this.runEventSequences.get(runId) ??
      Math.max(
        0,
        ...(this.runEvents.get(runId) ?? []).map((event) => event.sequence),
      );
    const next = current + 1;
    this.runEventSequences.set(runId, next);
    return next;
  }

  async listRunEventsAfter(
    runId: string,
    afterSequence: number,
    limit: number,
    signal?: AbortSignal,
  ): Promise<Ai.RunEvent[]> {
    signal?.throwIfAborted();
    return (this.runEvents.get(runId) ?? [])
      .filter((event) => event.sequence > afterSequence)
      .sort((left, right) => left.sequence - right.sequence)
      .slice(0, Math.max(1, limit));
  }

  async listRunEvents(runId: string): Promise<Ai.RunEvent[]> {
    return this.runEvents.get(runId) ?? [];
  }

  async deleteCompactedRunEventsBefore(
    orgId: string,
    before: string,
    now: string,
    limit: number,
  ): Promise<number> {
    const eligibleRunIds = new Set(
      this.data.runs
        .filter(
          (run) =>
            run.orgId === orgId &&
            (run.status === "cancelled" ||
              run.status === "completed" ||
              run.status === "failed") &&
            run.completedAt !== undefined &&
            run.completedAt < before,
        )
        .filter((run) => {
          const chat = this.data.chats.find((item) => item.id === run.chatId);
          return (
            chat?.legalHoldUntil === undefined || chat.legalHoldUntil <= now
          );
        })
        .map((run) => run.id),
    );
    const candidates = Array.from(this.runEvents.entries())
      .filter(([runId]) => eligibleRunIds.has(runId))
      .flatMap(([runId, events]) => {
        const latestSequence = Math.max(
          0,
          ...events.map((event) => event.sequence),
        );
        return events
          .filter((event) => event.sequence < latestSequence)
          .map((event) => ({ event, runId }));
      })
      .sort((left, right) =>
        left.event.createdAt === right.event.createdAt
          ? left.event.id.localeCompare(right.event.id)
          : left.event.createdAt.localeCompare(right.event.createdAt),
      )
      .slice(0, Math.max(1, limit));
    const candidateIds = new Set(candidates.map(({ event }) => event.id));
    for (const runId of eligibleRunIds) {
      const events = this.runEvents.get(runId);
      if (events === undefined) continue;
      this.runEvents.set(
        runId,
        events.filter((event) => !candidateIds.has(event.id)),
      );
    }
    return candidateIds.size;
  }

  async listToolCalls(orgId: string): Promise<E.ToolCallRecord[]> {
    return this.data.toolCalls
      .filter((call) => call.orgId === orgId)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  async listToolCallsForRun(
    orgId: string,
    workspaceId: string,
    runId: string,
    limit: number,
  ): Promise<E.ToolCallRecord[]> {
    return this.data.toolCalls
      .filter(
        (call) =>
          call.orgId === orgId &&
          call.workspaceId === workspaceId &&
          call.runId === runId,
      )
      .sort(
        (left, right) =>
          left.startedAt.localeCompare(right.startedAt) ||
          left.id.localeCompare(right.id),
      )
      .slice(0, Math.max(1, limit));
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
    if (plan.legalHold !== undefined)
      throw new Error(
        "Cannot delete a chat while an active legal hold exists.",
      );

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

    deleteChatDataInMemory({
      data: this.data,
      chatId: resourceId,
      messageIds,
      notificationIds,
      orgId,
      runEvents: this.runEvents,
      runIds,
    });

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
    if (
      this.data.messageFileReferences.some(
        (reference) => reference.fileId === fileId,
      )
    )
      throw new Error(
        "Cannot delete a file while governed message references exist.",
      );
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

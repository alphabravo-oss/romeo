import { and, count, eq, inArray, or, sql, type SQL } from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import {
  chatComments,
  chats,
  knowledgeChunkEmbeddings,
  knowledgeChunks,
  knowledgeSources,
  messageParts,
  messages,
  notificationDeliveries,
  objectRecords,
  resourceFavorites,
  resourceGrants,
  runEvents,
  runs,
  runSteps,
  toolCalls,
  usageEvents,
  userNotifications,
  workspaceFolderItems,
} from "./schema";
import { optionalIsoString, toIsoString } from "./repository-mapping";

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

type DataDeletionDatabase = Pick<RomeoDatabase, "delete" | "select" | "update">;

interface ChatDeletionContext {
  plan: DataDeletionPlanRecord;
  runIds: string[];
  messageIds: string[];
  notificationIds: string[];
}

export class PgDataDeletionRepository {
  constructor(private readonly db: RomeoDatabase) {}

  async getDataDeletionPlan(
    orgId: string,
    resourceType: DataDeletionResourceTypeRecord,
    resourceId: string,
  ): Promise<DataDeletionPlanRecord | undefined> {
    if (resourceType === "chat") {
      const context = await chatDeletionContext(this.db, orgId, resourceId);
      return context?.plan;
    }
    if (resourceType === "file_object") {
      return fileObjectDeletionPlan(this.db, orgId, resourceId);
    }
    if (resourceType === "knowledge_source") {
      return knowledgeSourceDeletionPlan(this.db, orgId, resourceId);
    }
    return undefined;
  }

  async deleteDataForResource(
    orgId: string,
    resourceType: DataDeletionResourceTypeRecord,
    resourceId: string,
  ): Promise<DataDeletionPlanRecord | undefined> {
    return this.db.transaction(async (tx) => {
      if (resourceType === "chat") {
        const context = await chatDeletionContext(tx, orgId, resourceId);
        if (context === undefined) return undefined;
        if (context.plan.legalHold !== undefined) {
          throw new Error(
            "Cannot delete a chat while an active legal hold exists.",
          );
        }

        await deleteChatData(tx, orgId, resourceId, context);
        return context.plan;
      }
      if (resourceType === "file_object") {
        const plan = await fileObjectDeletionPlan(tx, orgId, resourceId);
        if (plan === undefined) return undefined;
        await deleteFileObjectData(tx, orgId, resourceId);
        return plan;
      }
      if (resourceType === "knowledge_source") return undefined;
      return undefined;
    });
  }
}

async function chatDeletionContext(
  db: DataDeletionDatabase,
  orgId: string,
  chatId: string,
): Promise<ChatDeletionContext | undefined> {
  const [chat] = await db
    .select()
    .from(chats)
    .where(and(eq(chats.orgId, orgId), eq(chats.id, chatId)))
    .limit(1);
  if (chat === undefined) return undefined;

  const runRows = await db
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.orgId, orgId), eq(runs.chatId, chatId)));
  const messageRows = await db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.chatId, chatId));
  const notificationRows = await db
    .select({ id: userNotifications.id })
    .from(userNotifications)
    .where(
      and(
        eq(userNotifications.orgId, orgId),
        eq(userNotifications.resourceType, "chat"),
        eq(userNotifications.resourceId, chatId),
      ),
    );

  const runIds = runRows.map((row) => row.id);
  const messageIds = messageRows.map((row) => row.id);
  const notificationIds = notificationRows.map((row) => row.id);
  const legalHold = activeChatLegalHold(chat);

  return {
    plan: {
      orgId,
      workspaceId: chat.workspaceId,
      resourceType: "chat",
      resourceId: chat.id,
      ...(legalHold === undefined ? {} : { legalHold }),
      counts: {
        ...emptyDataDeletionCounts(),
        chats: 1,
        messages: messageIds.length,
        messageParts:
          messageIds.length === 0
            ? 0
            : await countRows(
                db
                  .select({ value: count() })
                  .from(messageParts)
                  .where(inArray(messageParts.messageId, messageIds)),
              ),
        runs: runIds.length,
        runSteps:
          runIds.length === 0
            ? 0
            : await countRows(
                db
                  .select({ value: count() })
                  .from(runSteps)
                  .where(inArray(runSteps.runId, runIds)),
              ),
        runEvents:
          runIds.length === 0
            ? 0
            : await countRows(
                db
                  .select({ value: count() })
                  .from(runEvents)
                  .where(inArray(runEvents.runId, runIds)),
              ),
        chatComments: await countRows(
          db
            .select({ value: count() })
            .from(chatComments)
            .where(
              and(
                eq(chatComments.orgId, orgId),
                eq(chatComments.chatId, chatId),
              ),
            ),
        ),
        userNotifications: notificationIds.length,
        notificationDeliveries:
          notificationIds.length === 0
            ? 0
            : await countRows(
                db
                  .select({ value: count() })
                  .from(notificationDeliveries)
                  .where(
                    inArray(
                      notificationDeliveries.notificationId,
                      notificationIds,
                    ),
                  ),
              ),
        runLinkedToolCalls:
          runIds.length === 0
            ? 0
            : await countRows(
                db
                  .select({ value: count() })
                  .from(toolCalls)
                  .where(
                    and(
                      eq(toolCalls.orgId, orgId),
                      inArray(toolCalls.runId, runIds),
                    ),
                  ),
              ),
        usageEvents: await countRows(
          db
            .select({ value: count() })
            .from(usageEvents)
            .where(chatUsageEventWhere(orgId, chatId, runIds, messageIds)),
        ),
        resourceGrants: await countRows(
          db
            .select({ value: count() })
            .from(resourceGrants)
            .where(
              and(
                eq(resourceGrants.orgId, orgId),
                eq(resourceGrants.resourceType, "chat"),
                eq(resourceGrants.resourceId, chatId),
              ),
            ),
        ),
        resourceFavorites: await countRows(
          db
            .select({ value: count() })
            .from(resourceFavorites)
            .where(
              and(
                eq(resourceFavorites.orgId, orgId),
                eq(resourceFavorites.resourceType, "chat"),
                eq(resourceFavorites.resourceId, chatId),
              ),
            ),
        ),
        workspaceFolderItems: await countRows(
          db
            .select({ value: count() })
            .from(workspaceFolderItems)
            .where(
              and(
                eq(workspaceFolderItems.orgId, orgId),
                eq(workspaceFolderItems.resourceType, "chat"),
                eq(workspaceFolderItems.resourceId, chatId),
              ),
            ),
        ),
      },
    },
    runIds,
    messageIds,
    notificationIds,
  };
}

async function fileObjectDeletionPlan(
  db: DataDeletionDatabase,
  orgId: string,
  fileId: string,
): Promise<DataDeletionPlanRecord | undefined> {
  const [file] = await db
    .select()
    .from(objectRecords)
    .where(
      and(
        eq(objectRecords.orgId, orgId),
        eq(objectRecords.id, fileId),
        sql`${objectRecords.status} <> 'deleted'`,
      ),
    )
    .limit(1);
  if (file === undefined) return undefined;

  return {
    orgId,
    workspaceId: file.workspaceId,
    resourceType: "file_object",
    resourceId: file.id,
    counts: {
      ...emptyDataDeletionCounts(),
      resourceGrants: await countRows(
        db
          .select({ value: count() })
          .from(resourceGrants)
          .where(
            and(
              eq(resourceGrants.orgId, orgId),
              eq(resourceGrants.resourceType, "file"),
              eq(resourceGrants.resourceId, fileId),
            ),
          ),
      ),
      fileObjects: 1,
      objectStoreObjects: fileObjectStorageObjectCount(file.metadata),
      objectStoreBytes: file.sizeBytes,
    },
  };
}

async function deleteFileObjectData(
  db: DataDeletionDatabase,
  orgId: string,
  fileId: string,
): Promise<void> {
  await db
    .delete(resourceGrants)
    .where(
      and(
        eq(resourceGrants.orgId, orgId),
        eq(resourceGrants.resourceType, "file"),
        eq(resourceGrants.resourceId, fileId),
      ),
    );
  await db
    .update(objectRecords)
    .set({
      status: "deleted",
      deletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(objectRecords.orgId, orgId), eq(objectRecords.id, fileId)));
}

async function knowledgeSourceDeletionPlan(
  db: DataDeletionDatabase,
  orgId: string,
  sourceId: string,
): Promise<DataDeletionPlanRecord | undefined> {
  const [source] = await db
    .select()
    .from(knowledgeSources)
    .where(
      and(eq(knowledgeSources.orgId, orgId), eq(knowledgeSources.id, sourceId)),
    )
    .limit(1);
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
      knowledgeChunks: await countRows(
        db
          .select({ value: count() })
          .from(knowledgeChunks)
          .where(eq(knowledgeChunks.sourceId, source.id)),
      ),
      knowledgeEmbeddings: await countRows(
        db
          .select({ value: count() })
          .from(knowledgeChunkEmbeddings)
          .where(eq(knowledgeChunkEmbeddings.sourceId, source.id)),
      ),
      objectStoreObjects: source.objectKey === null ? 0 : 1,
      objectStoreBytes: source.objectKey === null ? 0 : source.sizeBytes,
    },
  };
}

async function deleteChatData(
  db: DataDeletionDatabase,
  orgId: string,
  chatId: string,
  context: ChatDeletionContext,
): Promise<void> {
  await db
    .delete(usageEvents)
    .where(
      chatUsageEventWhere(orgId, chatId, context.runIds, context.messageIds),
    );
  await db
    .delete(resourceGrants)
    .where(
      and(
        eq(resourceGrants.orgId, orgId),
        eq(resourceGrants.resourceType, "chat"),
        eq(resourceGrants.resourceId, chatId),
      ),
    );
  await db
    .delete(resourceFavorites)
    .where(
      and(
        eq(resourceFavorites.orgId, orgId),
        eq(resourceFavorites.resourceType, "chat"),
        eq(resourceFavorites.resourceId, chatId),
      ),
    );
  await db
    .delete(workspaceFolderItems)
    .where(
      and(
        eq(workspaceFolderItems.orgId, orgId),
        eq(workspaceFolderItems.resourceType, "chat"),
        eq(workspaceFolderItems.resourceId, chatId),
      ),
    );

  if (context.notificationIds.length > 0) {
    await db
      .delete(notificationDeliveries)
      .where(
        inArray(notificationDeliveries.notificationId, context.notificationIds),
      );
    await db
      .delete(userNotifications)
      .where(inArray(userNotifications.id, context.notificationIds));
  }

  if (context.runIds.length > 0) {
    await db
      .delete(toolCalls)
      .where(
        and(
          eq(toolCalls.orgId, orgId),
          inArray(toolCalls.runId, context.runIds),
        ),
      );
    await db.delete(runEvents).where(inArray(runEvents.runId, context.runIds));
    await db.delete(runSteps).where(inArray(runSteps.runId, context.runIds));
    await db
      .delete(runs)
      .where(and(eq(runs.orgId, orgId), eq(runs.chatId, chatId)));
  }

  if (context.messageIds.length > 0) {
    await db
      .delete(messageParts)
      .where(inArray(messageParts.messageId, context.messageIds));
    await db.delete(messages).where(eq(messages.chatId, chatId));
  }

  await db
    .delete(chatComments)
    .where(and(eq(chatComments.orgId, orgId), eq(chatComments.chatId, chatId)));
  await db
    .delete(chats)
    .where(and(eq(chats.orgId, orgId), eq(chats.id, chatId)));
}

export function activeChatLegalHold(
  chat: Pick<typeof chats.$inferSelect, "legalHoldReason" | "legalHoldUntil">,
): DataDeletionPlanRecord["legalHold"] | undefined {
  if (chat.legalHoldUntil === null) return undefined;
  const until = toIsoString(chat.legalHoldUntil);
  if (new Date(until).getTime() <= Date.now()) return undefined;
  const reason = optionalIsoString(chat.legalHoldReason);
  return {
    until,
    ...(reason === undefined ? {} : { reason }),
  };
}

function chatUsageEventWhere(
  orgId: string,
  chatId: string,
  runIds: string[],
  messageIds: string[],
): SQL {
  const predicates: SQL[] = [
    and(
      eq(usageEvents.sourceType, "voice"),
      or(
        sql`${usageEvents.metadata}->>'chatId' = ${chatId}`,
        ...metadataMessageIdPredicates(messageIds),
      ),
    )!,
  ];
  if (runIds.length > 0) {
    predicates.push(
      and(
        eq(usageEvents.sourceType, "run"),
        inArray(usageEvents.sourceId, runIds),
      )!,
    );
  }

  return and(eq(usageEvents.orgId, orgId), or(...predicates)!)!;
}

function metadataMessageIdPredicates(messageIds: string[]): SQL[] {
  if (messageIds.length === 0) return [];
  return [
    sql`${usageEvents.metadata}->>'messageId' in (${sql.join(
      messageIds.map((messageId) => sql`${messageId}`),
      sql`, `,
    )})`,
  ];
}

async function countRows(
  rowsPromise: Promise<{ value: number }[]>,
): Promise<number> {
  const [row] = await rowsPromise;
  return row === undefined ? 0 : Number(row.value);
}

function emptyDataDeletionCounts(): DataDeletionCountsRecord {
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

function fileObjectStorageObjectCount(metadata: unknown): number {
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

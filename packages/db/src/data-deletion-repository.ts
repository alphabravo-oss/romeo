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
import {
  emptyDataDeletionCounts,
  fileObjectStorageObjectCount,
  type DataDeletionPlanRecord,
  type DataDeletionResourceTypeRecord,
} from "./data-deletion-records";
import { activeChatLegalHold } from "./data-deletion-legal-hold";
import { deleteFileObjectData } from "./file-data-deletion";
import {
  reconcileFileReferenceIds,
  referencedFileIdsForChat,
} from "./message-file-reference-repository";

export type * from "./data-deletion-records";
export { activeChatLegalHold };

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

        const transaction = tx as unknown as RomeoDatabase;
        const referencedFileIds = await referencedFileIdsForChat(
          transaction,
          resourceId,
        );
        await deleteChatData(tx, orgId, resourceId, context);
        await reconcileFileReferenceIds(
          transaction,
          referencedFileIds,
          new Date().toISOString(),
        );
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

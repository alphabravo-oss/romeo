import type {
  AuthorizedChatCatalogQuery,
  AuthorizedChatMessageSearchQuery,
  AuthorizedMessagePageQuery,
  CancelQueuedChatTurnInput,
  ClaimQueuedChatTurnInput,
  FinishQueuedChatTurnLeaseInput,
  RenewQueuedChatTurnLeaseInput,
  MessagePageQueryResult,
  ChatMessageSearchQueryResult,
} from "@romeo/core";
import { ApiError, persistedTextPartId, textPartForMessage } from "@romeo/core";
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gt,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import type { RomeoDatabase } from "./client";
import {
  chatComments,
  chats,
  messageParts,
  messages,
  resourceGrants,
} from "./schema";
import { optionalDate } from "./repository-mapping";
import { queryAuthorizedMessagePage } from "./message-page-repository";
import { searchAuthorizedChatMessages } from "./chat-message-search-repository";
import { PgQueuedChatTurnRepository } from "./queued-chat-turn-repository";
import {
  toChatCommentInsert,
  toChatCommentRecord,
  toChatInsert,
  toChatRecord,
  toMessageInsert,
  toMessagePartInsert,
  toMessageRecord,
  type ChatCommentRecord,
  type ChatRecord,
  type MessageRecord,
  type QueuedChatTurnRecord,
} from "./chat-repository-records";
import { PgMessagePartRepository } from "./message-part-repository";
import {
  reconcileFileReferenceIds,
  referencedFileIdsForMessage,
} from "./message-file-reference-repository";
import { containsPattern } from "./like-pattern";

export * from "./chat-repository-records";

export class PgChatRepository extends PgMessagePartRepository {
  private readonly queuedTurns: PgQueuedChatTurnRepository;

  constructor(db: RomeoDatabase) {
    super(db);
    this.queuedTurns = new PgQueuedChatTurnRepository(db);
  }
  async listChats(workspaceId: string): Promise<ChatRecord[]> {
    const rows = await this.db
      .select()
      .from(chats)
      .where(eq(chats.workspaceId, workspaceId))
      .orderBy(desc(chats.updatedAt), asc(chats.id));
    return rows.map(toChatRecord);
  }

  async listAuthorizedChatsPage(
    input: AuthorizedChatCatalogQuery,
  ): Promise<{ items: ChatRecord[]; total: number }> {
    const principalMatch = or(
      and(
        eq(resourceGrants.principalType, input.principalType),
        eq(resourceGrants.principalId, input.principalId),
      ),
      input.groupIds.length === 0
        ? undefined
        : and(
            eq(resourceGrants.principalType, "group"),
            inArray(resourceGrants.principalId, input.groupIds),
          ),
    );
    const grantMatch = exists(
      this.db
        .select({ value: sql`1` })
        .from(resourceGrants)
        .where(
          and(
            eq(resourceGrants.orgId, input.orgId),
            eq(resourceGrants.resourceType, "chat"),
            eq(resourceGrants.resourceId, chats.id),
            inArray(resourceGrants.permission, ["read", "write"]),
            principalMatch,
          ),
        ),
    );
    const predicate = and(
      eq(chats.orgId, input.orgId),
      eq(chats.workspaceId, input.workspaceId),
      or(isNull(chats.expiresAt), gt(chats.expiresAt, new Date(input.now))),
      input.archived === "all"
        ? undefined
        : input.archived === "archived"
          ? isNotNull(chats.archivedAt)
          : isNull(chats.archivedAt),
      input.isAdmin
        ? undefined
        : or(eq(chats.createdBy, input.principalId), grantMatch),
    );
    const [rows, totals] = await Promise.all([
      this.db
        .select()
        .from(chats)
        .where(predicate)
        .orderBy(desc(chats.updatedAt), asc(chats.id))
        .limit(input.limit)
        .offset(input.offset),
      this.db.select({ value: count() }).from(chats).where(predicate),
    ]);
    return {
      items: rows.map(toChatRecord),
      total: Number(totals[0]?.value ?? 0),
    };
  }

  async searchChatContent(
    workspaceId: string,
    query: string,
  ): Promise<Array<{ chatId: string; messageId?: string; snippet: string }>> {
    const pattern = containsPattern(query);
    const [titleRows, messageRows, attachmentRows] = await Promise.all([
      this.db
        .select({ chatId: chats.id, snippet: chats.title })
        .from(chats)
        .where(
          and(eq(chats.workspaceId, workspaceId), ilike(chats.title, pattern)),
        ),
      this.db
        .select({
          chatId: chats.id,
          messageId: messages.id,
          snippet: messages.content,
        })
        .from(messages)
        .innerJoin(chats, eq(messages.chatId, chats.id))
        .where(
          and(
            eq(chats.workspaceId, workspaceId),
            ilike(messages.content, pattern),
          ),
        ),
      this.db
        .select({
          chatId: chats.id,
          messageId: messages.id,
          snippet: sql<string>`${messageParts.metadata}->>'fileName'`,
        })
        .from(messageParts)
        .innerJoin(messages, eq(messageParts.messageId, messages.id))
        .innerJoin(chats, eq(messages.chatId, chats.id))
        .where(
          and(
            eq(chats.workspaceId, workspaceId),
            sql`${messageParts.metadata}->>'fileName' ILIKE ${pattern} ESCAPE '\\'`,
          ),
        ),
    ]);
    const byChat = new Map<
      string,
      { chatId: string; messageId?: string; snippet: string }
    >();
    for (const row of [...titleRows, ...messageRows, ...attachmentRows]) {
      if (byChat.has(row.chatId)) continue;
      const messageId =
        "messageId" in row && typeof row.messageId === "string"
          ? row.messageId
          : undefined;
      byChat.set(row.chatId, {
        chatId: row.chatId,
        snippet: row.snippet.slice(0, 220),
        ...(messageId === undefined ? {} : { messageId }),
      });
    }
    return [...byChat.values()];
  }

  async createChat(chat: ChatRecord): Promise<ChatRecord> {
    const [row] = await this.db
      .insert(chats)
      .values(toChatInsert(chat))
      .returning();
    return row === undefined ? chat : toChatRecord(row);
  }

  async updateChat(chat: ChatRecord): Promise<ChatRecord> {
    const [row] = await this.db
      .update(chats)
      .set({
        archivedAt: optionalDate(chat.archivedAt),
        legalHoldReason: chat.legalHoldReason ?? null,
        legalHoldUntil: optionalDate(chat.legalHoldUntil),
        title: chat.title,
        agentId: chat.agentId ?? null,
        modelId: chat.modelId ?? null,
        temporary: chat.temporary === true,
        expiresAt: optionalDate(chat.expiresAt),
        activeLeafMessageId: chat.activeLeafMessageId ?? null,
        updatedAt: new Date(chat.updatedAt),
      })
      .where(eq(chats.id, chat.id))
      .returning();
    return row === undefined ? chat : toChatRecord(row);
  }

  async getChat(chatId: string): Promise<ChatRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(chats)
      .where(eq(chats.id, chatId))
      .limit(1);
    return row === undefined ? undefined : toChatRecord(row);
  }

  listQueuedChatTurns(chatId: string): Promise<QueuedChatTurnRecord[]> {
    return this.queuedTurns.listQueuedChatTurns(chatId);
  }

  getQueuedChatTurn(turnId: string): Promise<QueuedChatTurnRecord | undefined> {
    return this.queuedTurns.getQueuedChatTurn(turnId);
  }

  getQueuedChatTurnByIdempotency(
    orgId: string,
    chatId: string,
    idempotencyKey: string,
  ): Promise<QueuedChatTurnRecord | undefined> {
    return this.queuedTurns.getQueuedChatTurnByIdempotency(
      orgId,
      chatId,
      idempotencyKey,
    );
  }

  createQueuedChatTurn(
    turn: QueuedChatTurnRecord,
  ): Promise<QueuedChatTurnRecord> {
    return this.queuedTurns.createQueuedChatTurn(turn);
  }

  claimNextQueuedChatTurn(
    input: ClaimQueuedChatTurnInput,
  ): Promise<QueuedChatTurnRecord | undefined> {
    return this.queuedTurns.claimNextQueuedChatTurn(input);
  }

  renewQueuedChatTurnLease(
    input: RenewQueuedChatTurnLeaseInput,
  ): Promise<QueuedChatTurnRecord | undefined> {
    return this.queuedTurns.renewQueuedChatTurnLease(input);
  }

  cancelQueuedChatTurn(
    input: CancelQueuedChatTurnInput,
  ): Promise<QueuedChatTurnRecord | undefined> {
    return this.queuedTurns.cancelQueuedChatTurn(input);
  }

  finishQueuedChatTurnLease(
    input: FinishQueuedChatTurnLeaseInput,
  ): Promise<QueuedChatTurnRecord | undefined> {
    return this.queuedTurns.finishQueuedChatTurnLease(input);
  }

  updateQueuedChatTurn(
    turn: QueuedChatTurnRecord,
  ): Promise<QueuedChatTurnRecord> {
    return this.queuedTurns.updateQueuedChatTurn(turn);
  }

  async listMessages(chatId: string): Promise<MessageRecord[]> {
    const rows = await this.db
      .select()
      .from(messages)
      .where(eq(messages.chatId, chatId))
      .orderBy(asc(messages.createdAt), asc(messages.id));
    return rows.map(toMessageRecord);
  }

  async queryAuthorizedMessagesPage(
    input: AuthorizedMessagePageQuery,
  ): Promise<MessagePageQueryResult> {
    return this.db.transaction(
      async (transaction) => {
        await transaction.execute(sql`set local statement_timeout = '2000ms'`);
        return queryAuthorizedMessagePage(
          transaction as unknown as RomeoDatabase,
          input,
        );
      },
      { accessMode: "read only", isolationLevel: "repeatable read" },
    );
  }

  async searchAuthorizedChatMessages(
    input: AuthorizedChatMessageSearchQuery,
  ): Promise<ChatMessageSearchQueryResult> {
    return searchAuthorizedChatMessages(this.db, input);
  }

  async getMessage(messageId: string): Promise<MessageRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(messages)
      .where(eq(messages.id, messageId))
      .limit(1);
    return row === undefined ? undefined : toMessageRecord(row);
  }

  async createMessage(message: MessageRecord): Promise<MessageRecord> {
    return this.db.transaction(async (rawTransaction) => {
      const transaction = rawTransaction as unknown as RomeoDatabase;
      const [row] = await transaction
        .insert(messages)
        .values(toMessageInsert(message))
        .returning();
      const created = row === undefined ? message : toMessageRecord(row);
      const textPart = textPartForMessage({
        id: persistedTextPartId(message.id),
        message,
        position: 0,
      });
      if (textPart !== undefined)
        await transaction
          .insert(messageParts)
          .values(toMessagePartInsert(textPart, 0));
      return created;
    });
  }

  async deleteMessage(messageId: string): Promise<void> {
    await this.db.transaction(async (transaction) => {
      const tx = transaction as unknown as RomeoDatabase;
      const [row] = await tx
        .select({ chatId: messages.chatId, parentId: messages.parentId })
        .from(messages)
        .where(eq(messages.id, messageId))
        .limit(1);
      if (row === undefined) return;
      const [chat] = await tx
        .select({ legalHoldUntil: chats.legalHoldUntil })
        .from(chats)
        .where(eq(chats.id, row.chatId))
        .limit(1)
        .for("update");
      const now = new Date();
      if (
        chat?.legalHoldUntil !== null &&
        chat?.legalHoldUntil !== undefined &&
        chat.legalHoldUntil > now
      )
        throw new ApiError(
          "chat_delete_legal_hold",
          "Chat is under legal hold and cannot be changed.",
          409,
        );
      const referencedFileIds = await referencedFileIdsForMessage(
        tx,
        messageId,
      );
      // Splice, don't sever: children adopt their grandparent. The transaction
      // keeps reparent, delete, leaf repair, and trigger version bumps atomic.
      await tx
        .update(messages)
        .set({ parentId: row.parentId })
        .where(eq(messages.parentId, messageId));
      await tx.delete(messages).where(eq(messages.id, messageId));
      await reconcileFileReferenceIds(tx, referencedFileIds, now.toISOString());
      const [newest] = await tx
        .select({ id: messages.id })
        .from(messages)
        .where(eq(messages.chatId, row.chatId))
        .orderBy(desc(messages.createdAt), desc(messages.id))
        .limit(1);
      const replacement = row.parentId ?? newest?.id ?? null;
      await tx
        .update(chats)
        .set({ activeLeafMessageId: replacement })
        .where(
          and(
            eq(chats.id, row.chatId),
            eq(chats.activeLeafMessageId, messageId),
          ),
        );
    });
  }

  async listChatComments(chatId: string): Promise<ChatCommentRecord[]> {
    const rows = await this.db
      .select()
      .from(chatComments)
      .where(eq(chatComments.chatId, chatId))
      .orderBy(asc(chatComments.createdAt), asc(chatComments.id));
    return rows.map(toChatCommentRecord);
  }

  async createChatComment(
    comment: ChatCommentRecord,
  ): Promise<ChatCommentRecord> {
    const [row] = await this.db
      .insert(chatComments)
      .values(toChatCommentInsert(comment))
      .returning();
    return row === undefined ? comment : toChatCommentRecord(row);
  }
}

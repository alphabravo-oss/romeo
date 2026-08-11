import type {
  AuthorizedChatCatalogQuery,
  CancelQueuedChatTurnInput,
  ClaimQueuedChatTurnInput,
  FinishQueuedChatTurnLeaseInput,
  RenewQueuedChatTurnLeaseInput,
} from "@romeo/core";
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
import { PgQueuedChatTurnRepository } from "./queued-chat-turn-repository";
import {
  toChatCommentInsert,
  toChatCommentRecord,
  toChatInsert,
  toChatRecord,
  toMessageInsert,
  toMessagePartInsert,
  toMessagePartRecord,
  toMessageRecord,
  type ChatCommentRecord,
  type ChatRecord,
  type MessagePartRecord,
  type MessageRecord,
  type QueuedChatTurnRecord,
} from "./chat-repository-records";

export * from "./chat-repository-records";

export class PgChatRepository {
  private readonly queuedTurns: PgQueuedChatTurnRepository;

  constructor(private readonly db: RomeoDatabase) {
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
    const pattern = `%${query.replace(/[\\%_]/gu, (value) => `\\${value}`)}%`;
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

  async getMessage(messageId: string): Promise<MessageRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(messages)
      .where(eq(messages.id, messageId))
      .limit(1);
    return row === undefined ? undefined : toMessageRecord(row);
  }

  async createMessage(message: MessageRecord): Promise<MessageRecord> {
    const [row] = await this.db
      .insert(messages)
      .values(toMessageInsert(message))
      .returning();
    return row === undefined ? message : toMessageRecord(row);
  }

  async deleteMessage(messageId: string): Promise<void> {
    const [row] = await this.db
      .select({ chatId: messages.chatId, parentId: messages.parentId })
      .from(messages)
      .where(eq(messages.id, messageId))
      .limit(1);
    if (row === undefined) return;
    // Splice, don't sever: children adopt their grandparent. Left dangling, every turn above the
    // deleted row falls off the branch and silently stops being replayed to the provider.
    await this.db
      .update(messages)
      .set({ parentId: row.parentId })
      .where(eq(messages.parentId, messageId));
    // message_parts.message_id has ON DELETE CASCADE, so this also removes
    // any attachment parts for the message.
    await this.db.delete(messages).where(eq(messages.id, messageId));
    // A pointer still naming the deleted row resolves to no branch, so the next turn would persist
    // as a fresh root and collapse the transcript. Its parent is the tip of what is left; a deleted
    // root has none, so fall back to the newest surviving row — a child is always written after its
    // parent, which makes the newest row a branch tip.
    const replacement =
      row.parentId ?? (await this.newestMessageId(row.chatId));
    await this.db
      .update(chats)
      .set({ activeLeafMessageId: replacement })
      .where(
        and(eq(chats.id, row.chatId), eq(chats.activeLeafMessageId, messageId)),
      );
  }

  private async newestMessageId(chatId: string): Promise<string | null> {
    // Reverse of listMessages' ordering, so both backends pick the same row.
    const [row] = await this.db
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.chatId, chatId))
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(1);
    return row?.id ?? null;
  }

  async listMessageParts(messageId: string): Promise<MessagePartRecord[]> {
    const rows = await this.db
      .select()
      .from(messageParts)
      .where(eq(messageParts.messageId, messageId))
      .orderBy(asc(messageParts.position), asc(messageParts.id));
    return rows.map(toMessagePartRecord);
  }

  async getMessagePart(
    messagePartId: string,
  ): Promise<MessagePartRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(messageParts)
      .where(eq(messageParts.id, messagePartId))
      .limit(1);
    return row === undefined ? undefined : toMessagePartRecord(row);
  }

  async createMessageParts(
    parts: MessagePartRecord[],
  ): Promise<MessagePartRecord[]> {
    if (parts.length === 0) return [];
    const rows = await this.db
      .insert(messageParts)
      .values(parts.map((part, index) => toMessagePartInsert(part, index)))
      .returning();
    return rows.map(toMessagePartRecord);
  }

  async updateMessagePart(part: MessagePartRecord): Promise<MessagePartRecord> {
    const [row] = await this.db
      .update(messageParts)
      .set({ content: part.content, metadata: part.metadata, type: part.type })
      .where(eq(messageParts.id, part.id))
      .returning();
    return row === undefined ? part : toMessagePartRecord(row);
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

import { asc, desc, eq } from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import { chatComments, chats, messageParts, messages } from "./schema";
import {
  asStringArray,
  optionalDate,
  optionalIsoString,
  toIsoString,
} from "./repository-mapping";

export interface ChatRecord {
  id: string;
  orgId: string;
  workspaceId: string;
  title: string;
  createdBy: string;
  archivedAt?: string;
  legalHoldUntil?: string;
  legalHoldReason?: string;
  updatedAt: string;
}

export interface MessageRecord {
  id: string;
  chatId: string;
  role: "assistant" | "system" | "tool" | "user";
  content: string;
  createdAt: string;
}

export interface MessagePartRecord {
  id: string;
  messageId: string;
  type: "attachment" | "collaboration_channel_metadata";
  content: string;
  metadata: Record<string, unknown>;
}

export interface ChatCommentRecord {
  id: string;
  orgId: string;
  chatId: string;
  authorId: string;
  body: string;
  mentionedUserIds: string[];
  createdAt: string;
}

export class PgChatRepository {
  constructor(private readonly db: RomeoDatabase) {}

  async listChats(workspaceId: string): Promise<ChatRecord[]> {
    const rows = await this.db
      .select()
      .from(chats)
      .where(eq(chats.workspaceId, workspaceId))
      .orderBy(desc(chats.updatedAt), asc(chats.id));
    return rows.map(toChatRecord);
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
    // message_parts.message_id has ON DELETE CASCADE, so this also removes
    // any attachment parts for the message.
    await this.db.delete(messages).where(eq(messages.id, messageId));
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

export function toChatRecord(row: typeof chats.$inferSelect): ChatRecord {
  const chat: ChatRecord = {
    id: row.id,
    orgId: row.orgId,
    workspaceId: row.workspaceId,
    title: row.title,
    createdBy: row.createdBy,
    updatedAt: toIsoString(row.updatedAt),
  };
  const archivedAt = optionalIsoString(row.archivedAt);
  if (archivedAt !== undefined) chat.archivedAt = archivedAt;
  const legalHoldUntil = optionalIsoString(row.legalHoldUntil);
  if (legalHoldUntil !== undefined) chat.legalHoldUntil = legalHoldUntil;
  const legalHoldReason = optionalIsoString(row.legalHoldReason);
  if (legalHoldReason !== undefined) chat.legalHoldReason = legalHoldReason;
  return chat;
}

export function toMessageRecord(
  row: typeof messages.$inferSelect,
): MessageRecord {
  return {
    id: row.id,
    chatId: row.chatId,
    role: row.role,
    content: row.content,
    createdAt: toIsoString(row.createdAt),
  };
}

export function toMessagePartRecord(
  row: typeof messageParts.$inferSelect,
): MessagePartRecord {
  return {
    id: row.id,
    messageId: row.messageId,
    type:
      row.type === "collaboration_channel_metadata"
        ? "collaboration_channel_metadata"
        : "attachment",
    content: row.content,
    metadata: asJsonRecord(row.metadata),
  };
}

export function toChatCommentRecord(
  row: typeof chatComments.$inferSelect,
): ChatCommentRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    chatId: row.chatId,
    authorId: row.authorId,
    body: row.body,
    mentionedUserIds: asStringArray(row.mentionedUserIds),
    createdAt: toIsoString(row.createdAt),
  };
}

function toChatInsert(record: ChatRecord): typeof chats.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    workspaceId: record.workspaceId,
    title: record.title,
    createdBy: record.createdBy,
    archivedAt: optionalDate(record.archivedAt),
    legalHoldUntil: optionalDate(record.legalHoldUntil),
    legalHoldReason: record.legalHoldReason ?? null,
    updatedAt: new Date(record.updatedAt),
  };
}

function toMessageInsert(record: MessageRecord): typeof messages.$inferInsert {
  return {
    id: record.id,
    chatId: record.chatId,
    role: record.role,
    content: record.content,
    createdAt: new Date(record.createdAt),
  };
}

function toMessagePartInsert(
  record: MessagePartRecord,
  position: number,
): typeof messageParts.$inferInsert {
  return {
    id: record.id,
    messageId: record.messageId,
    position,
    type: record.type,
    content: record.content,
    metadata: record.metadata,
  };
}

function toChatCommentInsert(
  record: ChatCommentRecord,
): typeof chatComments.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    chatId: record.chatId,
    authorId: record.authorId,
    body: record.body,
    mentionedUserIds: record.mentionedUserIds,
    createdAt: new Date(record.createdAt),
  };
}

function asJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return {};
  return value as Record<string, unknown>;
}

import { and, asc, count, eq } from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import { chatTagAssignments, chatTags } from "./schema";
import { toIsoString } from "./repository-mapping";

export interface ChatTagRecord {
  id: string;
  orgId: string;
  userId: string;
  slug: string;
  name: string;
  meta?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ChatTagAssignmentRecord {
  id: string;
  orgId: string;
  userId: string;
  chatId: string;
  tagId: string;
  createdAt: string;
}

export class PgChatTagRepository {
  constructor(private readonly db: RomeoDatabase) {}

  async listChatTags(
    orgId: string,
    userId: string,
  ): Promise<ChatTagRecord[]> {
    const rows = await this.db
      .select()
      .from(chatTags)
      .where(and(eq(chatTags.orgId, orgId), eq(chatTags.userId, userId)))
      .orderBy(asc(chatTags.name), asc(chatTags.slug));
    return rows.map(toChatTagRecord);
  }

  async listChatTagsForChat(
    orgId: string,
    userId: string,
    chatId: string,
  ): Promise<ChatTagRecord[]> {
    const rows = await this.db
      .select({ tag: chatTags })
      .from(chatTagAssignments)
      .innerJoin(chatTags, eq(chatTags.id, chatTagAssignments.tagId))
      .where(
        and(
          eq(chatTagAssignments.orgId, orgId),
          eq(chatTagAssignments.userId, userId),
          eq(chatTagAssignments.chatId, chatId),
        ),
      )
      .orderBy(asc(chatTags.name), asc(chatTags.slug));
    return rows.map((row) => toChatTagRecord(row.tag));
  }

  async listChatIdsByTag(
    orgId: string,
    userId: string,
    slug: string,
  ): Promise<string[]> {
    const rows = await this.db
      .select({ chatId: chatTagAssignments.chatId })
      .from(chatTagAssignments)
      .innerJoin(chatTags, eq(chatTags.id, chatTagAssignments.tagId))
      .where(
        and(
          eq(chatTagAssignments.orgId, orgId),
          eq(chatTagAssignments.userId, userId),
          eq(chatTags.slug, slug),
        ),
      )
      .orderBy(asc(chatTagAssignments.chatId));
    return rows.map((row) => row.chatId);
  }

  async upsertChatTag(tag: ChatTagRecord): Promise<ChatTagRecord> {
    const [row] = await this.db
      .insert(chatTags)
      .values(toChatTagInsert(tag))
      .onConflictDoUpdate({
        target: [chatTags.orgId, chatTags.userId, chatTags.slug],
        set: {
          meta: tag.meta ?? null,
          name: tag.name,
          updatedAt: new Date(tag.updatedAt),
        },
      })
      .returning();
    return row === undefined ? tag : toChatTagRecord(row);
  }

  async createChatTagAssignment(
    assignment: ChatTagAssignmentRecord,
  ): Promise<ChatTagAssignmentRecord> {
    const [row] = await this.db
      .insert(chatTagAssignments)
      .values(toChatTagAssignmentInsert(assignment))
      .onConflictDoNothing({
        target: [
          chatTagAssignments.orgId,
          chatTagAssignments.userId,
          chatTagAssignments.chatId,
          chatTagAssignments.tagId,
        ],
      })
      .returning();
    if (row !== undefined) return toChatTagAssignmentRecord(row);

    const [existing] = await this.db
      .select()
      .from(chatTagAssignments)
      .where(
        and(
          eq(chatTagAssignments.orgId, assignment.orgId),
          eq(chatTagAssignments.userId, assignment.userId),
          eq(chatTagAssignments.chatId, assignment.chatId),
          eq(chatTagAssignments.tagId, assignment.tagId),
        ),
      )
      .limit(1);
    return existing === undefined
      ? assignment
      : toChatTagAssignmentRecord(existing);
  }

  async deleteChatTagAssignment(
    orgId: string,
    userId: string,
    chatId: string,
    slug: string,
  ): Promise<ChatTagAssignmentRecord | undefined> {
    const [existing] = await this.db
      .select({ assignment: chatTagAssignments })
      .from(chatTagAssignments)
      .innerJoin(chatTags, eq(chatTags.id, chatTagAssignments.tagId))
      .where(
        and(
          eq(chatTagAssignments.orgId, orgId),
          eq(chatTagAssignments.userId, userId),
          eq(chatTagAssignments.chatId, chatId),
          eq(chatTags.slug, slug),
        ),
      )
      .limit(1);
    if (existing === undefined) return undefined;
    await this.db
      .delete(chatTagAssignments)
      .where(eq(chatTagAssignments.id, existing.assignment.id));
    return toChatTagAssignmentRecord(existing.assignment);
  }

  async countChatTagAssignments(
    orgId: string,
    userId: string,
    slug: string,
  ): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(chatTagAssignments)
      .innerJoin(chatTags, eq(chatTags.id, chatTagAssignments.tagId))
      .where(
        and(
          eq(chatTagAssignments.orgId, orgId),
          eq(chatTagAssignments.userId, userId),
          eq(chatTags.slug, slug),
        ),
      );
    return Number(row?.value ?? 0);
  }

  async deleteChatTag(
    orgId: string,
    userId: string,
    slug: string,
  ): Promise<ChatTagRecord | undefined> {
    const [existing] = await this.db
      .select()
      .from(chatTags)
      .where(
        and(
          eq(chatTags.orgId, orgId),
          eq(chatTags.userId, userId),
          eq(chatTags.slug, slug),
        ),
      )
      .limit(1);
    if (existing === undefined) return undefined;
    await this.db.delete(chatTags).where(eq(chatTags.id, existing.id));
    return toChatTagRecord(existing);
  }
}

export function toChatTagRecord(
  row: typeof chatTags.$inferSelect,
): ChatTagRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    userId: row.userId,
    slug: row.slug,
    name: row.name,
    ...(row.meta === null ? {} : { meta: row.meta }),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

export function toChatTagAssignmentRecord(
  row: typeof chatTagAssignments.$inferSelect,
): ChatTagAssignmentRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    userId: row.userId,
    chatId: row.chatId,
    tagId: row.tagId,
    createdAt: toIsoString(row.createdAt),
  };
}

function toChatTagInsert(record: ChatTagRecord): typeof chatTags.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    userId: record.userId,
    slug: record.slug,
    name: record.name,
    meta: record.meta ?? null,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}

function toChatTagAssignmentInsert(
  record: ChatTagAssignmentRecord,
): typeof chatTagAssignments.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    userId: record.userId,
    chatId: record.chatId,
    tagId: record.tagId,
    createdAt: new Date(record.createdAt),
  };
}

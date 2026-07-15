import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { messageRole } from "./enums";
import { organizations, workspaces } from "./tenancy";
import { users } from "./users";

export const chats = pgTable(
  "chats",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    title: text("title").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    legalHoldUntil: timestamp("legal_hold_until", { withTimezone: true }),
    legalHoldReason: text("legal_hold_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    chatsWorkspaceUpdatedIdx: index("chats_workspace_updated_idx").on(
      table.workspaceId,
      table.updatedAt,
    ),
  }),
);

export const messages = pgTable(
  "messages",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    role: messageRole("role").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    messagesChatCreatedIdx: index("messages_chat_created_idx").on(
      table.chatId,
      table.createdAt,
    ),
  }),
);

export const messageParts = pgTable(
  "message_parts",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    type: text("type").notNull(),
    content: text("content").notNull(),
    metadata: jsonb("metadata").notNull(),
  },
  (table) => ({
    messagePartsMessagePositionIdx: index(
      "message_parts_message_position_idx",
    ).on(table.messageId, table.position),
  }),
);

export const chatComments = pgTable(
  "chat_comments",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    authorId: text("author_id").notNull(),
    body: text("body").notNull(),
    mentionedUserIds: jsonb("mentioned_user_ids").$type<string[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    chatCommentChatIdx: index("chat_comment_chat_idx").on(
      table.orgId,
      table.chatId,
      table.createdAt,
    ),
  }),
);

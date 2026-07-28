import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { messageRole, queuedChatTurnStatus } from "./enums";
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
    modelId: text("model_id"),
    temporary: boolean("temporary").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
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
    chatsTitleTrgmIdx: index("chats_title_trgm_idx").using(
      "gin",
      table.title.op("gin_trgm_ops"),
    ),
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
    citations: jsonb("citations"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    messagesContentTrgmIdx: index("messages_content_trgm_idx").using(
      "gin",
      table.content.op("gin_trgm_ops"),
    ),
    messagesChatCreatedIdx: index("messages_chat_created_idx").on(
      table.chatId,
      table.createdAt,
    ),
  }),
);

export const queuedChatTurns = pgTable(
  "queued_chat_turns",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
    modelId: text("model_id"),
    content: text("content").notNull(),
    webSearch: boolean("web_search").notNull().default(false),
    urls: jsonb("urls").$type<string[]>().notNull().default([]),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    principalId: text("principal_id").notNull(),
    principalType: text("principal_type").notNull(),
    scopeSnapshot: jsonb("scope_snapshot")
      .$type<string[]>()
      .notNull()
      .default([]),
    idempotencyKey: text("idempotency_key").notNull(),
    status: queuedChatTurnStatus("status").notNull().default("queued"),
    attemptCount: integer("attempt_count").notNull().default(0),
    leaseOwner: text("lease_owner"),
    leaseToken: text("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    queuedChatTurnsChatOrderIdx: index("queued_chat_turns_chat_order_idx").on(
      table.chatId,
      table.status,
      table.createdAt,
      table.id,
    ),
    queuedChatTurnsLeaseIdx: index("queued_chat_turns_lease_idx").on(
      table.status,
      table.leaseExpiresAt,
    ),
    queuedChatTurnsOrgIdx: index("queued_chat_turns_org_idx").on(table.orgId),
    queuedChatTurnsIdempotencyIdx: uniqueIndex(
      "queued_chat_turns_idempotency_idx",
    ).on(table.orgId, table.chatId, table.idempotencyKey),
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
    messagePartsFilenameTrgmIdx: index("message_parts_filename_trgm_idx").using(
      "gin",
      sql`(${table.metadata}->>'fileName') gin_trgm_ops`,
    ),
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

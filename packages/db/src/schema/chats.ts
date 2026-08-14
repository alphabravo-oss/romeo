import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { ProviderReasoningPolicy } from "@romeo/providers";

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
    agentId: text("agent_id"),
    modelId: text("model_id"),
    temporary: boolean("temporary").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    legalHoldUntil: timestamp("legal_hold_until", { withTimezone: true }),
    legalHoldReason: text("legal_hold_reason"),
    // ponytail: message-tree pointers (chats.active_leaf_message_id,
    // messages.parent_id) are deliberately unconstrained text, not foreign
    // keys. Integrity on the app's own delete path is enforced in code instead
    // -- deleteMessage splices children onto their grandparent and retargets
    // this pointer -- so do not read the missing constraint as permission to
    // drop that repair. Ceiling: a write that bypasses the repository (a manual
    // DELETE, a future bulk purge) can still strand a pointer or a child, and
    // only the readers' dangling-pointer fallbacks catch it. Upgrade path: a
    // self reference with ON DELETE SET NULL, once integrity is worth the
    // circular-FK and purge-ordering cost.
    activeLeafMessageId: text("active_leaf_message_id"),
    transcriptVersion: bigint("transcript_version", { mode: "bigint" })
      .notNull()
      .default(0n),
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
    partsSchemaVersion: integer("parts_schema_version").notNull().default(0),
    citations: jsonb("citations"),
    // { code, message? } when a model run fails/cancels without a final answer.
    error: jsonb("error"),
    modelId: text("model_id"),
    parentId: text("parent_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    messagesContentTrgmIdx: index("messages_content_trgm_idx").using(
      "gin",
      table.content.op("gin_trgm_ops"),
    ),
    messagesChatCreatedIdIdx: index("messages_chat_created_id_idx").on(
      table.chatId,
      table.createdAt,
      table.id,
    ),
    messagesChatCreatedIdx: index("messages_chat_created_idx").on(
      table.chatId,
      table.createdAt,
    ),
    messagesChatParentCreatedIdIdx: index(
      "messages_chat_parent_created_id_idx",
    ).on(table.chatId, table.parentId, table.createdAt, table.id),
    messagesPartsSchemaVersionCheck: check(
      "messages_parts_schema_version_check",
      sql`${table.partsSchemaVersion} IN (0, 1)`,
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
    routingMode: text("routing_mode").notNull().default("selected"),
    researchMode: text("research_mode").notNull().default("standard"),
    reasoningPolicy: jsonb("reasoning_policy").$type<ProviderReasoningPolicy>(),
    parentMessageConfigured: boolean("parent_message_configured")
      .notNull()
      .default(false),
    parentMessageId: text("parent_message_id"),
    content: text("content").notNull(),
    webSearch: boolean("web_search").notNull().default(false),
    agenticRag: boolean("agentic_rag").notNull().default(false),
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
    canonicalPosition: integer("canonical_position"),
    schemaVersion: integer("schema_version").notNull().default(0),
    type: text("type").notNull(),
    content: text("content").notNull(),
    metadata: jsonb("metadata").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    messagePartsFilenameTrgmIdx: index("message_parts_filename_trgm_idx").using(
      "gin",
      sql`(${table.metadata}->>'fileName') gin_trgm_ops`,
    ),
    messagePartsMessagePositionIdx: index(
      "message_parts_message_position_idx",
    ).on(table.messageId, table.position),
    messagePartsCanonicalOrderIdx: index(
      "message_parts_canonical_order_idx",
    ).on(table.messageId, table.canonicalPosition, table.position, table.id),
    messagePartsCanonicalPositionUniqueIdx: uniqueIndex(
      "message_parts_message_canonical_position_unique_idx",
    )
      .on(table.messageId, table.canonicalPosition)
      .where(sql`${table.canonicalPosition} IS NOT NULL`),
    messagePartsPositionCheck: check(
      "message_parts_position_check",
      sql`(${table.schemaVersion} = 0 OR ${table.position} BETWEEN 0 AND 9999) AND (${table.canonicalPosition} IS NULL OR ${table.canonicalPosition} BETWEEN 0 AND 9999)`,
    ),
    messagePartsSchemaVersionCheck: check(
      "message_parts_schema_version_check",
      sql`${table.schemaVersion} IN (0, 1)`,
    ),
    messagePartsTypeVersionCheck: check(
      "message_parts_type_version_check",
      sql`${table.schemaVersion} = 0 OR ${table.type} IN ('text', 'image_ref', 'audio_ref', 'video_ref', 'document_ref', 'tool_result_ref', 'artifact_ref', 'citation_ref')`,
    ),
    messagePartsPayloadSizeCheck: check(
      "message_parts_payload_size_check",
      sql`${table.schemaVersion} = 0 OR (octet_length(${table.content}) <= 4000064 AND octet_length(${table.metadata}::text) <= 262144 AND (${table.type} = 'text' OR ${table.content} = '') AND (${table.type} <> 'text' OR (left(${table.content}, 22) = 'romeo-message-text-v1:' AND length(${table.content}) > 22)))`,
    ),
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

import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import { chats } from "./chats";
import { organizations } from "./tenancy";
import { users } from "./users";

export const chatTags = pgTable(
  "chat_tags",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    chatTagsUserSlugIdx: uniqueIndex("chat_tags_user_slug_idx").on(
      table.orgId,
      table.userId,
      table.slug,
    ),
    chatTagsUserNameIdx: index("chat_tags_user_name_idx").on(
      table.orgId,
      table.userId,
      table.name,
    ),
  }),
);

export const chatTagAssignments = pgTable(
  "chat_tag_assignments",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => chatTags.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    chatTagAssignmentsChatIdx: index("chat_tag_assignments_chat_idx").on(
      table.orgId,
      table.userId,
      table.chatId,
    ),
    chatTagAssignmentsTagIdx: index("chat_tag_assignments_tag_idx").on(
      table.orgId,
      table.userId,
      table.tagId,
    ),
    chatTagAssignmentsUniqueIdx: uniqueIndex(
      "chat_tag_assignments_unique_idx",
    ).on(table.orgId, table.userId, table.chatId, table.tagId),
  }),
);

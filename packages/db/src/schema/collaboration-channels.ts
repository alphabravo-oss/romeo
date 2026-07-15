import {
  boolean,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organizations, workspaces } from "./tenancy";
import { users } from "./users";

export const collaborationChannels = pgTable(
  "collaboration_channels",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    type: text("type"),
    name: text("name").notNull(),
    description: text("description"),
    isPrivate: boolean("is_private"),
    data: jsonb("data").$type<Record<string, unknown> | null>(),
    meta: jsonb("meta").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedBy: text("updated_by"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    archivedBy: text("archived_by"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deletedBy: text("deleted_by"),
  },
  (table) => ({
    collaborationChannelsOrgUpdatedIdx: index(
      "collaboration_channels_org_updated_idx",
    ).on(table.orgId, table.updatedAt),
    collaborationChannelsWorkspaceUpdatedIdx: index(
      "collaboration_channels_workspace_updated_idx",
    ).on(table.workspaceId, table.updatedAt),
    collaborationChannelsOwnerIdx: index("collaboration_channels_owner_idx").on(
      table.orgId,
      table.userId,
      table.updatedAt,
    ),
  }),
);

export const collaborationChannelMembers = pgTable(
  "collaboration_channel_members",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    channelId: text("channel_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role"),
    status: text("status"),
    isActive: boolean("is_active").notNull().default(true),
    isChannelMuted: boolean("is_channel_muted").notNull().default(false),
    isChannelPinned: boolean("is_channel_pinned").notNull().default(false),
    data: jsonb("data").$type<Record<string, unknown> | null>(),
    meta: jsonb("meta").$type<Record<string, unknown> | null>(),
    invitedAt: timestamp("invited_at", { withTimezone: true }),
    invitedBy: text("invited_by").references(() => users.id),
    joinedAt: timestamp("joined_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    leftAt: timestamp("left_at", { withTimezone: true }),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    collaborationChannelMembersChannelIdx: index(
      "collaboration_channel_members_channel_idx",
    ).on(table.orgId, table.channelId),
    collaborationChannelMembersUserIdx: index(
      "collaboration_channel_members_user_idx",
    ).on(table.orgId, table.userId, table.isActive),
    collaborationChannelMembersUniqueIdx: uniqueIndex(
      "collaboration_channel_members_unique_idx",
    ).on(table.orgId, table.channelId, table.userId),
    collaborationChannelMembersChannelFk: foreignKey({
      name: "collaboration_channel_members_channel_fk",
      columns: [table.channelId],
      foreignColumns: [collaborationChannels.id],
    }).onDelete("cascade"),
  }),
);

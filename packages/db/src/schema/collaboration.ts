import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organizations, workspaces } from "./tenancy";
import { users } from "./users";

export const resourceFavorites = pgTable(
  "resource_favorites",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    resourceFavoriteLookupIdx: index("resource_favorite_lookup_idx").on(
      table.orgId,
      table.userId,
      table.resourceType,
      table.resourceId,
    ),
    resourceFavoriteUniqueIdx: uniqueIndex("resource_favorite_unique_idx").on(
      table.orgId,
      table.userId,
      table.resourceType,
      table.resourceId,
    ),
  }),
);

export const promptTemplates = pgTable(
  "prompt_templates",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    name: text("name").notNull(),
    description: text("description"),
    body: text("body").notNull(),
    tags: text("tags").array().notNull(),
    visibility: text("visibility").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    promptTemplateWorkspaceIdx: index("prompt_template_workspace_idx").on(
      table.orgId,
      table.workspaceId,
      table.visibility,
    ),
    promptTemplateWorkspaceNameIdx: uniqueIndex(
      "prompt_template_workspace_name_idx",
    ).on(table.orgId, table.workspaceId, table.name),
  }),
);

export const workspaceFolders = pgTable(
  "workspace_folders",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    name: text("name").notNull(),
    parentId: text("parent_id"),
    meta: jsonb("meta").$type<Record<string, unknown> | null>(),
    data: jsonb("data").$type<Record<string, unknown> | null>(),
    isExpanded: boolean("is_expanded").notNull().default(false),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    workspaceFolderWorkspaceIdx: index("workspace_folder_workspace_idx").on(
      table.orgId,
      table.workspaceId,
    ),
    workspaceFolderNameIdx: uniqueIndex("workspace_folder_name_idx").on(
      table.orgId,
      table.workspaceId,
      table.name,
    ),
  }),
);

export const workspaceFolderItems = pgTable(
  "workspace_folder_items",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    folderId: text("folder_id")
      .notNull()
      .references(() => workspaceFolders.id),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    workspaceFolderItemFolderIdx: index("workspace_folder_item_folder_idx").on(
      table.orgId,
      table.folderId,
    ),
    workspaceFolderItemResourceIdx: index(
      "workspace_folder_item_resource_idx",
    ).on(table.orgId, table.resourceType, table.resourceId),
    workspaceFolderItemUniqueIdx: uniqueIndex(
      "workspace_folder_item_unique_idx",
    ).on(table.folderId, table.resourceType, table.resourceId),
  }),
);

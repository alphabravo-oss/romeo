import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organizations, workspaces } from "./tenancy";
import { users } from "./users";

export const serverTableSavedViews = pgTable(
  "server_table_saved_views",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workspaceId: text("workspace_id").notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    resource: text("resource").notNull(),
    parentId: text("parent_id"),
    parentScopeKey: text("parent_scope_key").notNull().default(""),
    name: text("name").notNull(),
    nameNormalized: text("name_normalized").notNull(),
    query: jsonb("query")
      .$type<{
        sort: Array<{ field: string; direction: "asc" | "desc" }>;
        filters: Array<{ field: string; operator: string; value?: unknown }>;
        search?: string;
        pageSize: number;
      }>()
      .notNull(),
    presentation: jsonb("presentation")
      .$type<{
        columnVisibility: Record<string, boolean>;
        density: "comfortable" | "compact";
      }>()
      .notNull(),
    visibility: text("visibility").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    schemaVersion: integer("schema_version").notNull(),
    version: integer("version").notNull(),
    deleteTokenHash: text("delete_token_hash"),
    deleteTokenExpiresAt: timestamp("delete_token_expires_at", {
      withTimezone: true,
    }),
    deletedWasDefault: boolean("deleted_was_default"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantWorkspaceFk: foreignKey({
      columns: [table.orgId, table.workspaceId],
      foreignColumns: [workspaces.orgId, workspaces.id],
      name: "server_table_saved_views_org_workspace_fk",
    }).onDelete("cascade"),
    tenantOwnerFk: foreignKey({
      columns: [table.orgId, table.ownerUserId],
      foreignColumns: [users.orgId, users.id],
      name: "server_table_saved_views_org_owner_fk",
    }).onDelete("cascade"),
    parentScopeMatches: check(
      "server_table_saved_views_parent_scope_matches",
      sql`${table.parentScopeKey} = coalesce(${table.parentId}, '')`,
    ),
    visibilityValid: check(
      "server_table_saved_views_visibility_valid",
      sql`${table.visibility} in ('private', 'workspace')`,
    ),
    versionsPositive: check(
      "server_table_saved_views_versions_positive",
      sql`${table.schemaVersion} > 0 and ${table.version} > 0`,
    ),
    queryShapeValid: check(
      "server_table_saved_views_query_shape_valid",
      sql`jsonb_typeof(${table.query}) = 'object'
        and jsonb_typeof(${table.query} -> 'sort') = 'array'
        and jsonb_typeof(${table.query} -> 'filters') = 'array'
        and (${table.query} ->> 'pageSize')::integer in (10, 25, 50, 100)`,
    ),
    deleteTokenLifecycleValid: check(
      "server_table_saved_views_delete_token_lifecycle_valid",
      sql`(
        ${table.deletedAt} is null
        and ${table.deleteTokenHash} is null
        and ${table.deleteTokenExpiresAt} is null
        and ${table.deletedWasDefault} is null
      ) or (
        ${table.deletedAt} is not null
        and ${table.deleteTokenHash} is not null
        and ${table.deleteTokenExpiresAt} is not null
        and ${table.deleteTokenExpiresAt} > ${table.deletedAt}
        and ${table.deletedWasDefault} is not null
      )`,
    ),
    listIdx: index("server_table_saved_views_list_idx").on(
      table.orgId,
      table.workspaceId,
      table.resource,
      table.parentScopeKey,
      table.visibility,
      table.ownerUserId,
      table.nameNormalized,
    ),
    activeOwnerNameUnique: uniqueIndex(
      "server_table_saved_views_active_owner_name_uidx",
    )
      .on(
        table.orgId,
        table.workspaceId,
        table.resource,
        table.parentScopeKey,
        table.ownerUserId,
        table.nameNormalized,
      )
      .where(sql`${table.deletedAt} is null`),
    activeOwnerDefaultUnique: uniqueIndex(
      "server_table_saved_views_active_owner_default_uidx",
    )
      .on(
        table.orgId,
        table.workspaceId,
        table.resource,
        table.parentScopeKey,
        table.ownerUserId,
      )
      .where(sql`${table.deletedAt} is null and ${table.isDefault} = true`),
  }),
);

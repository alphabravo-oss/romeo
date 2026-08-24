import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organizations, workspaces } from "./tenancy";

export const systemSettings = pgTable(
  "system_settings",
  {
    key: text("key").notNull(),
    scopeOrgId: text("scope_org_id").notNull(),
    orgId: text("org_id").references(() => organizations.id),
    value: jsonb("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    systemSettingsScopeMatchesOrg: check(
      "system_settings_scope_matches_org",
      sql`(${table.scopeOrgId} = '__global__' AND ${table.orgId} IS NULL) OR ${table.scopeOrgId} = ${table.orgId}`,
    ),
    systemSettingsPk: primaryKey({
      columns: [table.scopeOrgId, table.key],
      name: "system_settings_pkey",
    }),
    systemSettingsOrgKeyIdx: index("system_settings_org_key_idx").on(
      table.orgId,
      table.key,
    ),
  }),
);

export const featureFlags = pgTable("feature_flags", {
  key: text("key").primaryKey(),
  enabled: boolean("enabled").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const backgroundJobs = pgTable(
  "background_jobs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    workspaceId: text("workspace_id").references(() => workspaces.id),
    type: text("type").notNull(),
    status: text("status").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    backgroundJobsOrgIdIdUnique: uniqueIndex(
      "background_jobs_org_id_id_uidx",
    ).on(table.orgId, table.id),
    backgroundJobsOrgCreatedIdx: index("background_jobs_org_created_idx").on(
      table.orgId,
      table.createdAt,
    ),
    backgroundJobsPageCreatedIdx: index(
      "background_jobs_org_created_id_idx",
    ).on(table.orgId, table.createdAt, table.id),
    backgroundJobsPageStatusIdx: index("background_jobs_org_status_id_idx").on(
      table.orgId,
      table.status,
      table.id,
    ),
    backgroundJobsPageTypeIdx: index("background_jobs_org_type_id_idx").on(
      table.orgId,
      table.type,
      table.id,
    ),
    backgroundJobsSearchIdx: index("background_jobs_search_trgm_idx").using(
      "gin",
      sql`(lower(coalesce(${table.id}, '') || chr(31) || coalesce(${table.type}, '') || chr(31) || coalesce(${table.status}, ''))) gin_trgm_ops`,
    ),
    backgroundJobsWorkspaceCreatedIdx: index(
      "background_jobs_workspace_created_idx",
    ).on(table.orgId, table.workspaceId, table.createdAt),
    backgroundJobsStatusUpdatedIdx: index(
      "background_jobs_status_updated_idx",
    ).on(table.orgId, table.status, table.updatedAt),
    backgroundJobsTypeStatusCreatedIdx: index(
      "background_jobs_org_type_status_created_id_idx",
    ).on(table.orgId, table.type, table.status, table.createdAt, table.id),
    backgroundJobsTypeStatusUpdatedIdx: index(
      "background_jobs_org_type_status_updated_id_idx",
    ).on(table.orgId, table.type, table.status, table.updatedAt, table.id),
  }),
);

export const orgSsoOidcSettings = pgTable("org_sso_oidc_settings", {
  orgId: text("org_id")
    .primaryKey()
    .references(() => organizations.id),
  enabled: boolean("enabled").notNull().default(false),
  issuerUrl: text("issuer_url").notNull().default(""),
  clientId: text("client_id").notNull().default(""),
  groupClaim: text("group_claim").notNull().default("groups"),
  adminGroups: jsonb("admin_groups").notNull().default([]),
  groupMap: jsonb("group_map").notNull().default({}),
  workspaceGroupMap: jsonb("workspace_group_map").notNull().default({}),
  workspaceGroupPrefix: text("workspace_group_prefix").notNull().default(""),
  createdBy: text("created_by").notNull(),
  updatedBy: text("updated_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

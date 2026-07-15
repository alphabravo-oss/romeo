import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { organizations, workspaces } from "./tenancy";

export const systemSettings = pgTable("system_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

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
    backgroundJobsOrgCreatedIdx: index("background_jobs_org_created_idx").on(
      table.orgId,
      table.createdAt,
    ),
    backgroundJobsWorkspaceCreatedIdx: index(
      "background_jobs_workspace_created_idx",
    ).on(table.orgId, table.workspaceId, table.createdAt),
    backgroundJobsStatusUpdatedIdx: index(
      "background_jobs_status_updated_idx",
    ).on(table.orgId, table.status, table.updatedAt),
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

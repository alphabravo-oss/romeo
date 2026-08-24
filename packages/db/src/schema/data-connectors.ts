import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { knowledgeBases } from "./knowledge";
import { organizations, workspaces } from "./tenancy";
import { users } from "./users";

export const dataConnectors = pgTable(
  "data_connectors",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    knowledgeBaseId: text("knowledge_base_id")
      .notNull()
      .references(() => knowledgeBases.id),
    type: text("type").notNull(),
    name: text("name").notNull(),
    config: jsonb("config").notNull(),
    status: text("status").notNull(),
    syncIntervalMinutes: integer("sync_interval_minutes"),
    nextSyncAt: timestamp("next_sync_at", { withTimezone: true }),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    syncLeaseOwner: text("sync_lease_owner"),
    syncLeaseToken: text("sync_lease_token"),
    syncLeaseExpiresAt: timestamp("sync_lease_expires_at", {
      withTimezone: true,
    }),
    syncFence: integer("sync_fence").notNull().default(0),
    syncAttempts: integer("sync_attempts").notNull().default(0),
  },
  (table) => ({
    dataConnectorsWorkspaceCreatedIdx: index(
      "data_connectors_workspace_created_idx",
    ).on(table.orgId, table.workspaceId, table.createdAt),
    dataConnectorsWorkspaceNameIdx: uniqueIndex(
      "data_connectors_workspace_name_idx",
    ).on(table.workspaceId, table.name),
    dataConnectorsKnowledgeBaseIdx: index("data_connectors_kb_idx").on(
      table.knowledgeBaseId,
    ),
    dataConnectorsDueSyncIdx: index("data_connectors_due_sync_lease_idx").on(
      table.orgId,
      table.status,
      table.nextSyncAt,
      table.syncLeaseExpiresAt,
    ),
  }),
);

export const dataConnectorSyncs = pgTable(
  "data_connector_syncs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    knowledgeBaseId: text("knowledge_base_id")
      .notNull()
      .references(() => knowledgeBases.id),
    connectorId: text("connector_id")
      .notNull()
      .references(() => dataConnectors.id),
    status: text("status").notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    itemCount: integer("item_count").notNull().default(0),
    sourceIds: jsonb("source_ids").notNull(),
    summary: jsonb("summary").notNull(),
    errorCode: text("error_code"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    fencingToken: integer("fencing_token"),
    leaseToken: text("lease_token"),
  },
  (table) => ({
    dataConnectorSyncsOrgStartedIdx: index(
      "data_connector_syncs_org_started_idx",
    ).on(table.orgId, table.startedAt),
    dataConnectorSyncsConnectorStartedIdx: index(
      "data_connector_syncs_connector_started_idx",
    ).on(table.orgId, table.connectorId, table.startedAt),
    dataConnectorSyncsPageStartedIdx: index(
      "data_connector_syncs_org_connector_started_id_idx",
    ).on(table.orgId, table.connectorId, table.startedAt, table.id),
    dataConnectorSyncsPageStatusIdx: index(
      "data_connector_syncs_org_connector_status_id_idx",
    ).on(table.orgId, table.connectorId, table.status, table.id),
    dataConnectorSyncsSearchIdx: index(
      "data_connector_syncs_search_trgm_idx",
    ).using(
      "gin",
      sql`(lower(coalesce(${table.id}, '') || chr(31) || coalesce(${table.status}, ''))) gin_trgm_ops`,
    ),
  }),
);

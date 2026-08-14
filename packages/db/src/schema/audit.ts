import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { organizations } from "./tenancy";
import { users } from "./users";

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    outcome: text("outcome").notNull(),
    metadata: jsonb("metadata").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    auditLogsOrgCreatedIdx: index("audit_logs_org_created_idx").on(
      table.orgId,
      table.createdAt,
    ),
    auditLogsOrgCreatedIdIdx: index("audit_logs_org_created_id_idx").on(
      table.orgId,
      table.createdAt,
      table.id,
    ),
    auditLogsResourceIdx: index("audit_logs_resource_idx").on(
      table.orgId,
      table.resourceType,
      table.resourceId,
    ),
    auditLogsActorCreatedIdx: index("audit_logs_actor_created_idx").on(
      table.orgId,
      table.actorId,
      table.createdAt,
    ),
    auditLogsSearchTrgmIdx: index("audit_logs_search_trgm_idx").using(
      "gin",
      sql`(lower(${table.action} || chr(31) || ${table.actorId} || chr(31) || ${table.resourceType} || chr(31) || ${table.resourceId})) gin_trgm_ops`,
    ),
  }),
);

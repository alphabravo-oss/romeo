import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organizations } from "./tenancy";

export const capabilityAssignments = pgTable(
  "capability_assignments",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    scopeType: text("scope_type").notNull(),
    scopeId: text("scope_id").notNull(),
    capabilityId: text("capability_id").notNull(),
    state: text("state").notNull(),
    configuration: jsonb("configuration")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    version: bigint("version", { mode: "number" }).notNull(),
    supersedesId: text("supersedes_id"),
    actorId: text("actor_id").notNull(),
    reason: text("reason").notNull(),
    effectiveAt: timestamp("effective_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    activeUniqueIdx: uniqueIndex("capability_assignment_active_unique_idx")
      .on(table.orgId, table.scopeType, table.scopeId, table.capabilityId)
      .where(sql`${table.revokedAt} is null`),
    configSizeCheck: check(
      "capability_assignment_config_size_check",
      sql`octet_length(${table.configuration}::text) <= 16384`,
    ),
    effectiveLookupIdx: index("capability_assignment_effective_lookup_idx").on(
      table.orgId,
      table.scopeType,
      table.scopeId,
      table.capabilityId,
      table.effectiveAt,
    ),
    effectiveTimeCheck: check(
      "capability_assignment_effective_time_check",
      sql`${table.effectiveAt} <= ${table.createdAt}`,
    ),
    expiryCheck: check(
      "capability_assignment_expiry_check",
      sql`${table.expiresAt} is null or ${table.expiresAt} > ${table.effectiveAt}`,
    ),
    historyIdx: index("capability_assignment_history_idx").on(
      table.orgId,
      table.scopeType,
      table.scopeId,
      table.capabilityId,
      table.version,
    ),
    reasonCheck: check(
      "capability_assignment_reason_check",
      sql`char_length(${table.reason}) between 1 and 1000`,
    ),
    scopeTypeCheck: check(
      "capability_assignment_scope_type_check",
      sql`${table.scopeType} in ('organization', 'workspace', 'agent', 'group', 'user')`,
    ),
    stateCheck: check(
      "capability_assignment_state_check",
      sql`${table.state} in ('inherit', 'enabled', 'disabled', 'required')`,
    ),
    supersedesFk: foreignKey({
      name: "capability_assignments_supersedes_fk",
      columns: [table.supersedesId],
      foreignColumns: [table.id],
    }),
    versionCheck: check(
      "capability_assignment_version_check",
      sql`${table.version} > 0`,
    ),
    versionUniqueIdx: uniqueIndex(
      "capability_assignment_version_unique_idx",
    ).on(
      table.orgId,
      table.scopeType,
      table.scopeId,
      table.capabilityId,
      table.version,
    ),
  }),
);

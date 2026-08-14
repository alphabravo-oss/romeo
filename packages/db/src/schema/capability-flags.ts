import type { OrganizationCapabilityFlag } from "@romeo/core";
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

export const organizationCapabilityFlags = pgTable(
  "organization_capability_flags",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    flagId: text("flag_id").notNull(),
    state: text("state").notNull(),
    allowlistedSubjects: jsonb("allowlisted_subjects")
      .$type<OrganizationCapabilityFlag["allowlistedSubjects"]>()
      .notNull()
      .default([]),
    version: bigint("version", { mode: "number" }).notNull(),
    supersedesId: text("supersedes_id"),
    actorId: text("actor_id").notNull(),
    reason: text("reason").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    activeUniqueIdx: uniqueIndex(
      "organization_capability_flag_active_unique_idx",
    )
      .on(table.orgId, table.flagId)
      .where(sql`${table.revokedAt} is null`),
    allowlistSizeCheck: check(
      "organization_capability_flag_allowlist_size_check",
      sql`jsonb_typeof(${table.allowlistedSubjects}) = 'array' and jsonb_array_length(${table.allowlistedSubjects}) <= 100 and octet_length(${table.allowlistedSubjects}::text) <= 32768`,
    ),
    historyIdx: index("organization_capability_flag_history_idx").on(
      table.orgId,
      table.flagId,
      table.version,
    ),
    reasonCheck: check(
      "organization_capability_flag_reason_check",
      sql`char_length(${table.reason}) between 1 and 1000`,
    ),
    stateCheck: check(
      "organization_capability_flag_state_check",
      sql`${table.state} in ('disabled', 'preview', 'enabled')`,
    ),
    supersedesFk: foreignKey({
      name: "organization_capability_flags_supersedes_fk",
      columns: [table.supersedesId],
      foreignColumns: [table.id],
    }),
    versionCheck: check(
      "organization_capability_flag_version_check",
      sql`${table.version} > 0`,
    ),
    versionUniqueIdx: uniqueIndex(
      "organization_capability_flag_version_unique_idx",
    ).on(table.orgId, table.flagId, table.version),
  }),
);

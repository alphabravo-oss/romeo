import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { organizations } from "./tenancy";
import { users } from "./users";

export const retentionPolicies = pgTable("retention_policies", {
  orgId: text("org_id")
    .primaryKey()
    .references(() => organizations.id),
  auditLogRetentionDays: integer("audit_log_retention_days").notNull(),
  updatedBy: text("updated_by")
    .notNull()
    .references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

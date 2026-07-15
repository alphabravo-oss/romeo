import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { quotaScopeType } from "./enums";
import { organizations } from "./tenancy";

export const quotaBuckets = pgTable(
  "quota_buckets",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    scopeType: quotaScopeType("scope_type").notNull(),
    scopeId: text("scope_id").notNull(),
    metric: text("metric").notNull(),
    limit: integer("limit_value").notNull(),
    used: integer("used").notNull(),
    resetInterval: text("reset_interval").notNull().default("none"),
    resetAt: timestamp("reset_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    quotaBucketScopeMetricIdx: uniqueIndex("quota_bucket_scope_metric_idx").on(
      table.orgId,
      table.scopeType,
      table.scopeId,
      table.metric,
    ),
    quotaBucketsOrgMetricIdx: index("quota_buckets_org_metric_idx").on(
      table.orgId,
      table.metric,
    ),
    quotaBucketsResetIdx: index("quota_buckets_reset_idx").on(
      table.orgId,
      table.resetAt,
    ),
  }),
);

import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { organizations, workspaces } from "./tenancy";
import { users } from "./users";

export const usageEvents = pgTable(
  "usage_events",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    workspaceId: text("workspace_id").references(() => workspaces.id),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    metric: text("metric").notNull(),
    quantity: integer("quantity").notNull(),
    unit: text("unit").notNull(),
    metadata: jsonb("metadata").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    usageEventsOrgCreatedIdx: index("usage_events_org_created_idx").on(
      table.orgId,
      table.createdAt,
    ),
    usageEventsWorkspaceCreatedIdx: index(
      "usage_events_workspace_created_idx",
    ).on(table.orgId, table.workspaceId, table.createdAt),
    usageEventsSourceIdx: index("usage_events_source_idx").on(
      table.orgId,
      table.sourceType,
      table.sourceId,
    ),
    usageEventsMetricCreatedIdx: index("usage_events_metric_created_idx").on(
      table.orgId,
      table.metric,
      table.createdAt,
    ),
  }),
);

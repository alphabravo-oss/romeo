import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organizations } from "./tenancy";

export const billingPlans = pgTable(
  "billing_plans",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull(),
    source: text("source").notNull(),
    quotaTemplates: jsonb("quota_templates").notNull(),
    metadata: jsonb("metadata").notNull(),
    externalCustomerId: text("external_customer_id"),
    externalSubscriptionId: text("external_subscription_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    billingPlanOrgIdx: uniqueIndex("billing_plan_org_idx").on(table.orgId),
    billingPlansExternalCustomerIdx: index(
      "billing_plans_external_customer_idx",
    ).on(table.externalCustomerId),
    billingPlansExternalSubscriptionIdx: index(
      "billing_plans_external_subscription_idx",
    ).on(table.externalSubscriptionId),
  }),
);

import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { webhookDeliveryStatus } from "./enums";
import { organizations } from "./tenancy";
import { users } from "./users";

export const webhookSubscriptions = pgTable(
  "webhook_subscriptions",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    url: text("url").notNull(),
    eventTypes: jsonb("event_types").$type<string[]>().notNull(),
    createdBy: text("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
  },
  (table) => ({
    webhookSubscriptionsOrgCreatedIdx: index(
      "webhook_subscriptions_org_created_idx",
    ).on(table.orgId, table.createdAt),
    webhookSubscriptionsOrgUrlIdx: uniqueIndex(
      "webhook_subscriptions_org_url_idx",
    ).on(table.orgId, table.url),
  }),
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    subscriptionId: text("subscription_id")
      .notNull()
      .references(() => webhookSubscriptions.id),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: webhookDeliveryStatus("status").notNull(),
    attemptCount: integer("attempt_count").notNull(),
    responseStatus: integer("response_status"),
    errorCode: text("error_code"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    webhookDeliveriesOrgCreatedIdx: index(
      "webhook_deliveries_org_created_idx",
    ).on(table.orgId, table.createdAt),
    webhookDeliveriesSubscriptionCreatedIdx: index(
      "webhook_deliveries_subscription_created_idx",
    ).on(table.orgId, table.subscriptionId, table.createdAt),
    webhookDeliveriesRetryDueIdx: index("webhook_deliveries_retry_due_idx").on(
      table.status,
      table.nextAttemptAt,
    ),
  }),
);

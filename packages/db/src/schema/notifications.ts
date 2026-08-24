import { sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organizations } from "./tenancy";
import { users } from "./users";

export const userNotifications = pgTable(
  "user_notifications",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    type: text("type").notNull(),
    actorId: text("actor_id").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    metadata: jsonb("metadata").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userNotificationLookupIdx: index("user_notification_lookup_idx").on(
      table.orgId,
      table.userId,
      table.createdAt,
    ),
    userNotificationUnreadIdx: index("user_notification_unread_idx").on(
      table.orgId,
      table.userId,
      table.readAt,
    ),
    userNotificationResourceIdx: index("user_notification_resource_idx").on(
      table.orgId,
      table.resourceType,
      table.resourceId,
    ),
    userNotificationPageCreatedIdx: index(
      "user_notifications_org_user_created_id_idx",
    ).on(table.orgId, table.userId, table.createdAt, table.id),
    userNotificationPageTypeIdx: index(
      "user_notifications_org_user_type_id_idx",
    ).on(table.orgId, table.userId, table.type, table.id),
    userNotificationSearchIdx: index(
      "user_notifications_search_trgm_idx",
    ).using(
      "gin",
      sql`(lower(coalesce(${table.id}, '') || chr(31) || coalesce(${table.type}, '') || chr(31) || coalesce(${table.resourceId}, ''))) gin_trgm_ops`,
    ),
  }),
);

export const notificationDeliveryChannels = pgTable(
  "notification_delivery_channels",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    type: text("type").notNull(),
    name: text("name").notNull(),
    config: jsonb("config").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    notificationDeliveryChannelLookupIdx: index(
      "notification_delivery_channel_lookup_idx",
    ).on(table.orgId, table.userId, table.enabled),
    notificationDeliveryChannelUserNameIdx: uniqueIndex(
      "notification_delivery_channel_user_name_idx",
    ).on(table.orgId, table.userId, table.name),
  }),
);

export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    notificationId: text("notification_id").notNull(),
    channelId: text("channel_id").notNull(),
    status: text("status").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    errorCode: text("error_code"),
    metadata: jsonb("metadata").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    leaseOwner: text("lease_owner"),
    leaseToken: text("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    deliveryFence: integer("delivery_fence").notNull().default(0),
    leaseAttempts: integer("lease_attempts").notNull().default(0),
    providerIdempotencyKey: text("provider_idempotency_key"),
  },
  (table) => ({
    notificationDeliveryNotificationIdx: index(
      "notification_delivery_notification_idx",
    ).on(table.orgId, table.notificationId),
    notificationDeliveryUserIdx: index("notification_delivery_user_idx").on(
      table.orgId,
      table.userId,
      table.createdAt,
    ),
    notificationDeliveryStatusIdx: index(
      "notification_delivery_status_lease_idx",
    ).on(table.orgId, table.status, table.leaseExpiresAt, table.updatedAt),
    notificationDeliveryPageCreatedIdx: index(
      "notification_deliveries_org_user_created_id_idx",
    ).on(table.orgId, table.userId, table.createdAt, table.id),
    notificationDeliveryPageStatusIdx: index(
      "notification_deliveries_org_user_status_id_idx",
    ).on(table.orgId, table.userId, table.status, table.id),
    notificationDeliverySearchIdx: index(
      "notification_deliveries_search_trgm_idx",
    ).using(
      "gin",
      sql`(lower(coalesce(${table.id}, '') || chr(31) || coalesce(${table.status}, '') || chr(31) || coalesce(${table.errorCode}, ''))) gin_trgm_ops`,
    ),
    notificationDeliveryNotificationFk: foreignKey({
      name: "notification_deliveries_notification_fk",
      columns: [table.notificationId],
      foreignColumns: [userNotifications.id],
    }).onDelete("cascade"),
    notificationDeliveryChannelFk: foreignKey({
      name: "notification_deliveries_channel_fk",
      columns: [table.channelId],
      foreignColumns: [notificationDeliveryChannels.id],
    }),
  }),
);

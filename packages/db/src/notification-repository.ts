import { and, asc, desc, eq } from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import {
  notificationDeliveries,
  notificationDeliveryChannels,
  userNotifications,
} from "./schema";
import {
  optionalDate,
  optionalIsoString,
  toIsoString,
} from "./repository-mapping";

export type NotificationTypeRecord =
  | "chat_mention"
  | "support_impersonation_request_created"
  | "support_impersonation_request_approved"
  | "support_impersonation_request_rejected"
  | "support_impersonation_session_created"
  | "support_impersonation_session_revoked";
export type NotificationResourceTypeRecord =
  | "chat"
  | "support_impersonation_request"
  | "support_impersonation_session";
export type NotificationDeliveryChannelTypeRecord =
  | "email"
  | "mobile_push"
  | "pagerduty"
  | "slack"
  | "teams"
  | "webhook";
export type NotificationDeliveryStatusRecord =
  | "disabled"
  | "failed"
  | "pending"
  | "sent";

export interface UserNotificationRecord {
  id: string;
  orgId: string;
  userId: string;
  type: NotificationTypeRecord;
  actorId: string;
  resourceType: NotificationResourceTypeRecord;
  resourceId: string;
  metadata: Record<string, unknown>;
  readAt?: string;
  createdAt: string;
}

export interface NotificationDeliveryChannelRecord {
  id: string;
  orgId: string;
  userId: string;
  type: NotificationDeliveryChannelTypeRecord;
  name: string;
  config: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationDeliveryRecord {
  id: string;
  orgId: string;
  userId: string;
  notificationId: string;
  channelId: string;
  status: NotificationDeliveryStatusRecord;
  attemptCount: number;
  errorCode?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deliveredAt?: string;
}

export class PgNotificationRepository {
  constructor(private readonly db: RomeoDatabase) {}

  async listUserNotifications(
    orgId: string,
    userId: string,
  ): Promise<UserNotificationRecord[]> {
    const rows = await this.db
      .select()
      .from(userNotifications)
      .where(
        and(
          eq(userNotifications.orgId, orgId),
          eq(userNotifications.userId, userId),
        ),
      )
      .orderBy(desc(userNotifications.createdAt), asc(userNotifications.id));
    return rows.map(toUserNotificationRecord);
  }

  async createUserNotification(
    notification: UserNotificationRecord,
  ): Promise<UserNotificationRecord> {
    const [row] = await this.db
      .insert(userNotifications)
      .values(toUserNotificationInsert(notification))
      .returning();
    return row === undefined ? notification : toUserNotificationRecord(row);
  }

  async updateUserNotification(
    notification: UserNotificationRecord,
  ): Promise<UserNotificationRecord> {
    const [row] = await this.db
      .update(userNotifications)
      .set({
        metadata: notification.metadata,
        readAt: optionalDate(notification.readAt),
      })
      .where(eq(userNotifications.id, notification.id))
      .returning();
    return row === undefined ? notification : toUserNotificationRecord(row);
  }

  async listNotificationDeliveryChannels(
    orgId: string,
    userId: string,
  ): Promise<NotificationDeliveryChannelRecord[]> {
    const rows = await this.db
      .select()
      .from(notificationDeliveryChannels)
      .where(
        and(
          eq(notificationDeliveryChannels.orgId, orgId),
          eq(notificationDeliveryChannels.userId, userId),
        ),
      )
      .orderBy(
        desc(notificationDeliveryChannels.createdAt),
        asc(notificationDeliveryChannels.id),
      );
    return rows.map(toNotificationDeliveryChannelRecord);
  }

  async createNotificationDeliveryChannel(
    channel: NotificationDeliveryChannelRecord,
  ): Promise<NotificationDeliveryChannelRecord> {
    const [row] = await this.db
      .insert(notificationDeliveryChannels)
      .values(toNotificationDeliveryChannelInsert(channel))
      .returning();
    return row === undefined
      ? channel
      : toNotificationDeliveryChannelRecord(row);
  }

  async listNotificationDeliveries(
    orgId: string,
    userId: string,
  ): Promise<NotificationDeliveryRecord[]> {
    const rows = await this.db
      .select()
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.orgId, orgId),
          eq(notificationDeliveries.userId, userId),
        ),
      )
      .orderBy(
        desc(notificationDeliveries.createdAt),
        asc(notificationDeliveries.id),
      );
    return rows.map(toNotificationDeliveryRecord);
  }

  async createNotificationDelivery(
    delivery: NotificationDeliveryRecord,
  ): Promise<NotificationDeliveryRecord> {
    const [row] = await this.db
      .insert(notificationDeliveries)
      .values(toNotificationDeliveryInsert(delivery))
      .returning();
    return row === undefined ? delivery : toNotificationDeliveryRecord(row);
  }

  async updateNotificationDelivery(
    delivery: NotificationDeliveryRecord,
  ): Promise<NotificationDeliveryRecord> {
    const [row] = await this.db
      .update(notificationDeliveries)
      .set({
        attemptCount: delivery.attemptCount,
        deliveredAt: optionalDate(delivery.deliveredAt),
        errorCode: delivery.errorCode ?? null,
        metadata: delivery.metadata,
        status: delivery.status,
        updatedAt: new Date(delivery.updatedAt),
      })
      .where(eq(notificationDeliveries.id, delivery.id))
      .returning();
    return row === undefined ? delivery : toNotificationDeliveryRecord(row);
  }
}

export function toUserNotificationRecord(
  row: typeof userNotifications.$inferSelect,
): UserNotificationRecord {
  const notification: UserNotificationRecord = {
    id: row.id,
    orgId: row.orgId,
    userId: row.userId,
    type: asNotificationType(row.type),
    actorId: row.actorId,
    resourceType: asNotificationResourceType(row.resourceType),
    resourceId: row.resourceId,
    metadata: asJsonRecord(row.metadata),
    createdAt: toIsoString(row.createdAt),
  };
  const readAt = optionalIsoString(row.readAt);
  if (readAt !== undefined) notification.readAt = readAt;
  return notification;
}

export function toNotificationDeliveryChannelRecord(
  row: typeof notificationDeliveryChannels.$inferSelect,
): NotificationDeliveryChannelRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    userId: row.userId,
    type: asNotificationDeliveryChannelType(row.type),
    name: row.name,
    config: asJsonRecord(row.config),
    enabled: row.enabled,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

export function toNotificationDeliveryRecord(
  row: typeof notificationDeliveries.$inferSelect,
): NotificationDeliveryRecord {
  const delivery: NotificationDeliveryRecord = {
    id: row.id,
    orgId: row.orgId,
    userId: row.userId,
    notificationId: row.notificationId,
    channelId: row.channelId,
    status: asNotificationDeliveryStatus(row.status),
    attemptCount: row.attemptCount,
    metadata: asJsonRecord(row.metadata),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
  const errorCode = optionalIsoString(row.errorCode);
  if (errorCode !== undefined) delivery.errorCode = errorCode;
  const deliveredAt = optionalIsoString(row.deliveredAt);
  if (deliveredAt !== undefined) delivery.deliveredAt = deliveredAt;
  return delivery;
}

function toUserNotificationInsert(
  record: UserNotificationRecord,
): typeof userNotifications.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    userId: record.userId,
    type: record.type,
    actorId: record.actorId,
    resourceType: record.resourceType,
    resourceId: record.resourceId,
    metadata: record.metadata,
    readAt: optionalDate(record.readAt),
    createdAt: new Date(record.createdAt),
  };
}

function toNotificationDeliveryChannelInsert(
  record: NotificationDeliveryChannelRecord,
): typeof notificationDeliveryChannels.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    userId: record.userId,
    type: record.type,
    name: record.name,
    config: record.config,
    enabled: record.enabled,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}

function toNotificationDeliveryInsert(
  record: NotificationDeliveryRecord,
): typeof notificationDeliveries.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    userId: record.userId,
    notificationId: record.notificationId,
    channelId: record.channelId,
    status: record.status,
    attemptCount: record.attemptCount,
    errorCode: record.errorCode ?? null,
    metadata: record.metadata,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    deliveredAt: optionalDate(record.deliveredAt),
  };
}

function asNotificationType(value: string): NotificationTypeRecord {
  if (
    value === "chat_mention" ||
    value === "support_impersonation_request_created" ||
    value === "support_impersonation_request_approved" ||
    value === "support_impersonation_request_rejected" ||
    value === "support_impersonation_session_created" ||
    value === "support_impersonation_session_revoked"
  ) {
    return value;
  }
  return "chat_mention";
}

function asNotificationResourceType(
  value: string,
): NotificationResourceTypeRecord {
  if (
    value === "chat" ||
    value === "support_impersonation_request" ||
    value === "support_impersonation_session"
  ) {
    return value;
  }
  return "chat";
}

function asNotificationDeliveryChannelType(
  value: string,
): NotificationDeliveryChannelTypeRecord {
  if (
    value === "email" ||
    value === "mobile_push" ||
    value === "pagerduty" ||
    value === "slack" ||
    value === "teams" ||
    value === "webhook"
  )
    return value;
  return "webhook";
}

function asNotificationDeliveryStatus(
  value: string,
): NotificationDeliveryStatusRecord {
  if (
    value === "disabled" ||
    value === "failed" ||
    value === "pending" ||
    value === "sent"
  ) {
    return value;
  }
  return "failed";
}

function asJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return {};
  return value as Record<string, unknown>;
}

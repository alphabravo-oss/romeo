import {
  notificationDeliveries,
  notificationDeliveryChannels,
  userNotifications,
} from "./schema";
import type {
  NotificationDeliveryChannelRecord,
  NotificationDeliveryChannelTypeRecord,
  NotificationDeliveryRecord,
  NotificationDeliveryStatusRecord,
  NotificationResourceTypeRecord,
  NotificationTypeRecord,
  UserNotificationRecord,
} from "./notification-repository";
import {
  optionalDate,
  optionalIsoString,
  toIsoString,
} from "./repository-mapping";

export function toUserNotificationRecord(
  row: typeof userNotifications.$inferSelect,
): UserNotificationRecord {
  const record: UserNotificationRecord = {
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
  if (readAt !== undefined) record.readAt = readAt;
  return record;
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
  const record: NotificationDeliveryRecord = {
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
  if (errorCode !== undefined) record.errorCode = errorCode;
  const deliveredAt = optionalIsoString(row.deliveredAt);
  if (deliveredAt !== undefined) record.deliveredAt = deliveredAt;
  if (
    row.leaseOwner !== null &&
    row.leaseToken !== null &&
    row.leaseExpiresAt !== null
  ) {
    record.deliveryLease = {
      attempt: row.leaseAttempts,
      expiresAt: row.leaseExpiresAt.toISOString(),
      fencingToken: row.deliveryFence,
      owner: row.leaseOwner,
      token: row.leaseToken,
    };
  }
  if (row.providerIdempotencyKey !== null)
    record.providerIdempotencyKey = row.providerIdempotencyKey;
  return record;
}

export function toUserNotificationInsert(
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

export function toNotificationDeliveryChannelInsert(
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

export function toNotificationDeliveryInsert(
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
    providerIdempotencyKey: record.providerIdempotencyKey ?? record.id,
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
  )
    return value;
  return "chat_mention";
}

function asNotificationResourceType(
  value: string,
): NotificationResourceTypeRecord {
  if (
    value === "chat" ||
    value === "support_impersonation_request" ||
    value === "support_impersonation_session"
  )
    return value;
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
  )
    return value;
  return "failed";
}

function asJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return {};
  return value as Record<string, unknown>;
}

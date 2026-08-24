import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import {
  notificationDeliveries,
  notificationDeliveryChannels,
  userNotifications,
} from "./schema";
import { optionalDate } from "./repository-mapping";
import {
  toNotificationDeliveryChannelInsert,
  toNotificationDeliveryChannelRecord,
  toNotificationDeliveryInsert,
  toNotificationDeliveryRecord,
  toUserNotificationInsert,
  toUserNotificationRecord,
} from "./notification-record-mapping";

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
  deliveryLease?: {
    attempt: number;
    expiresAt: string;
    fencingToken: number;
    owner: string;
    token: string;
  };
  providerIdempotencyKey?: string;
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

  async listFailedNotificationDeliveries(
    orgId: string,
    limit: number,
  ): Promise<NotificationDeliveryRecord[]> {
    const rows = await this.db
      .select()
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.orgId, orgId),
          eq(notificationDeliveries.status, "failed"),
        ),
      )
      .orderBy(
        asc(notificationDeliveries.updatedAt),
        asc(notificationDeliveries.id),
      )
      .limit(limit);
    return rows.map(toNotificationDeliveryRecord);
  }

  async claimDueNotificationDeliveries(input: {
    leaseExpiresAt: string;
    leaseOwner: string;
    leaseToken: string;
    limit: number;
    now: string;
    orgId: string;
  }): Promise<NotificationDeliveryRecord[]> {
    return this.db.transaction(async (transaction) => {
      const now = new Date(input.now);
      const candidates = await transaction
        .select({ id: notificationDeliveries.id })
        .from(notificationDeliveries)
        .where(
          and(
            eq(notificationDeliveries.orgId, input.orgId),
            eq(notificationDeliveries.status, "failed"),
            lt(notificationDeliveries.attemptCount, 5),
            sql`${notificationDeliveries.metadata}->'deadLetter' is null`,
            sql`case
              when jsonb_typeof(${notificationDeliveries.metadata}->'nextAttemptAt') = 'string'
                and (${notificationDeliveries.metadata}->>'nextAttemptAt')
                  ~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?(Z|[+-]\\d{2}:\\d{2})$'
              then (${notificationDeliveries.metadata}->>'nextAttemptAt')::timestamptz <= ${now}
              else true
            end`,
            or(
              isNull(notificationDeliveries.leaseExpiresAt),
              lte(notificationDeliveries.leaseExpiresAt, now),
            ),
          ),
        )
        .orderBy(
          asc(notificationDeliveries.updatedAt),
          asc(notificationDeliveries.id),
        )
        .limit(Math.max(1, Math.min(input.limit, 1_000)))
        .for("update", { skipLocked: true });
      if (candidates.length === 0) return [];
      const rows = await transaction
        .update(notificationDeliveries)
        .set({
          deliveryFence: sql`${notificationDeliveries.deliveryFence} + 1`,
          leaseAttempts: sql`${notificationDeliveries.leaseAttempts} + 1`,
          leaseExpiresAt: new Date(input.leaseExpiresAt),
          leaseOwner: input.leaseOwner,
          leaseToken: input.leaseToken,
          providerIdempotencyKey: sql`coalesce(${notificationDeliveries.providerIdempotencyKey}, ${notificationDeliveries.id})`,
          updatedAt: now,
        })
        .where(
          inArray(
            notificationDeliveries.id,
            candidates.map((candidate) => candidate.id),
          ),
        )
        .returning();
      return rows.map(toNotificationDeliveryRecord);
    });
  }

  async finishNotificationDeliveryLease(input: {
    delivery: NotificationDeliveryRecord;
    fencingToken: number;
    leaseOwner: string;
    leaseToken: string;
    now: string;
  }): Promise<NotificationDeliveryRecord | undefined> {
    const now = new Date(input.now);
    const [row] = await this.db
      .update(notificationDeliveries)
      .set({
        attemptCount: input.delivery.attemptCount,
        deliveredAt: optionalDate(input.delivery.deliveredAt),
        errorCode: input.delivery.errorCode ?? null,
        leaseExpiresAt: null,
        leaseOwner: null,
        leaseToken: null,
        metadata: input.delivery.metadata,
        providerIdempotencyKey:
          input.delivery.providerIdempotencyKey ?? input.delivery.id,
        status: input.delivery.status,
        updatedAt: new Date(input.delivery.updatedAt),
      })
      .where(
        and(
          eq(notificationDeliveries.id, input.delivery.id),
          eq(notificationDeliveries.deliveryFence, input.fencingToken),
          eq(notificationDeliveries.leaseOwner, input.leaseOwner),
          eq(notificationDeliveries.leaseToken, input.leaseToken),
          gt(notificationDeliveries.leaseExpiresAt, now),
        ),
      )
      .returning();
    return row === undefined ? undefined : toNotificationDeliveryRecord(row);
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

export {
  toNotificationDeliveryChannelRecord,
  toNotificationDeliveryRecord,
  toUserNotificationRecord,
} from "./notification-record-mapping";

import { assertScope, type AuthSubject } from "@romeo/auth";

import {
  notificationChannelPolicyBlockReason,
  notificationPolicyBlockReason,
  type NotificationPolicy,
  type NotificationPolicyReport,
  type UpdateNotificationPolicyRequest,
} from "../domain/notification-policy";
import type {
  BackgroundJob,
  NotificationDelivery,
  NotificationDeliveryChannel,
  NotificationDeliveryChannelType,
  UserNotification,
  User,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { assertAbuseControlsAllow } from "./abuse-control-service";
import { writeAuditLog } from "./audit-log";
import {
  completeBackgroundJob,
  failBackgroundJob,
  startBackgroundJob,
} from "./job-service";
import {
  createPolicyBlockedNotificationDelivery,
  disabledNotificationDeliverySender,
  maxNotificationAttempts,
  policyBlockedNotificationDelivery,
  type NotificationDeliverySender,
} from "./notification-delivery";
import {
  normalizeNotificationChannelConfig,
  toPublicNotificationDeliveryChannel,
  type PublicNotificationDeliveryChannel,
} from "./notification-channel-config";
import {
  applyNotificationPolicyUpdate,
  isEmptyNotificationPolicyUpdate,
  notificationPolicyAuditMetadata,
  policySettingKey,
  readNotificationPolicy,
  toNotificationPolicyReport,
} from "./notification-policy-storage";

export { readNotificationPolicy } from "./notification-policy-storage";
export type { PublicNotificationDeliveryChannel } from "./notification-channel-config";

export interface NotificationRetryResult {
  job: BackgroundJob;
  deliveries: NotificationDelivery[];
}

export class NotificationService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly deliverySender: NotificationDeliverySender = disabledNotificationDeliverySender,
  ) {}

  list(subject: AuthSubject): Promise<UserNotification[]> {
    assertScope(subject, "me:read");
    return this.repository.listUserNotifications(subject.orgId, subject.id);
  }

  async markRead(
    subject: AuthSubject,
    notificationId: string,
  ): Promise<UserNotification> {
    assertScope(subject, "me:read");
    const notification = (
      await this.repository.listUserNotifications(subject.orgId, subject.id)
    ).find((item) => item.id === notificationId);
    if (!notification) throw notFound("Notification");
    if (notification.readAt !== undefined) return notification;
    return this.repository.updateUserNotification({
      ...notification,
      readAt: new Date().toISOString(),
    });
  }

  async channels(
    subject: AuthSubject,
  ): Promise<PublicNotificationDeliveryChannel[]> {
    assertScope(subject, "me:read");
    const channels = await this.repository.listNotificationDeliveryChannels(
      subject.orgId,
      subject.id,
    );
    return channels.map(toPublicNotificationDeliveryChannel);
  }

  async createChannel(input: {
    subject: AuthSubject;
    type: NotificationDeliveryChannelType;
    name: string;
    config: Record<string, unknown>;
  }): Promise<PublicNotificationDeliveryChannel> {
    assertScope(input.subject, "me:read");
    const now = new Date().toISOString();
    const channel = {
      id: createId("notification_channel"),
      orgId: input.subject.orgId,
      userId: input.subject.id,
      type: input.type,
      name: input.name,
      config: normalizeNotificationChannelConfig(input.type, input.config),
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
    const policy = await readNotificationPolicy(
      this.repository,
      input.subject.orgId,
    );
    const blockReason = notificationChannelPolicyBlockReason({
      policy: policy.policy,
      channel,
    });
    if (blockReason !== undefined) {
      throw new ApiError(
        blockReason,
        "Notification channel is blocked by the organization notification policy.",
        400,
      );
    }
    const created =
      await this.repository.createNotificationDeliveryChannel(channel);
    return toPublicNotificationDeliveryChannel(created);
  }

  deliveries(subject: AuthSubject): Promise<NotificationDelivery[]> {
    assertScope(subject, "me:read");
    return this.repository.listNotificationDeliveries(
      subject.orgId,
      subject.id,
    );
  }

  policy(subject: AuthSubject): Promise<NotificationPolicyReport> {
    assertScope(subject, "admin:read");
    return readNotificationPolicy(this.repository, subject.orgId);
  }

  async updatePolicy(input: {
    subject: AuthSubject;
    policy: UpdateNotificationPolicyRequest;
  }): Promise<NotificationPolicyReport> {
    assertScope(input.subject, "admin:write");
    if (isEmptyNotificationPolicyUpdate(input.policy)) {
      throw new ApiError(
        "notification_policy_empty_update",
        "Notification policy update must include at least one field.",
        400,
      );
    }

    return this.repository.transaction(async (repository) => {
      const existing = await readNotificationPolicy(
        repository,
        input.subject.orgId,
      );
      const now = new Date().toISOString();
      const updatedPolicy = applyNotificationPolicyUpdate(
        existing.policy,
        input.policy,
      );
      await repository.upsertSystemSetting({
        key: policySettingKey(input.subject.orgId),
        value: {
          version: 1,
          orgId: input.subject.orgId,
          policy: updatedPolicy,
          updatedAt: now,
          updatedBy: input.subject.id,
        },
        updatedAt: now,
      });
      const updated = toNotificationPolicyReport(
        input.subject.orgId,
        updatedPolicy,
        now,
        input.subject.id,
      );
      await writeAuditLog(repository, {
        subject: input.subject,
        action: "admin.notification_policy.update",
        resourceType: "notification_policy",
        resourceId: input.subject.orgId,
        metadata: notificationPolicyAuditMetadata(existing, updated),
      });
      return updated;
    });
  }

  async retryDueDeliveries(
    subject: AuthSubject,
  ): Promise<NotificationRetryResult> {
    assertScope(subject, "admin:write");
    await assertAbuseControlsAllow(this.repository, subject, {
      action: "worker.enqueue",
      workerClass: "notification.delivery",
    });
    const job = await startBackgroundJob(this.repository, {
      orgId: subject.orgId,
      type: "notification.retry_due",
      payload: { requestedBy: subject.id },
    });

    try {
      const deliveries: NotificationDelivery[] = [];
      const now = new Date().toISOString();
      const policy = await readNotificationPolicy(
        this.repository,
        subject.orgId,
      );
      const users = await this.repository.listUsers(subject.orgId);
      for (const user of users) {
        if (user.disabledAt !== undefined) continue;
        const userDeliveries = await this.repository.listNotificationDeliveries(
          subject.orgId,
          user.id,
        );
        for (const delivery of userDeliveries.filter((item) =>
          isDueRetry(item, now),
        )) {
          const retried = await this.retryDeliveryForUser(
            user,
            delivery,
            policy.policy,
          );
          if (retried !== undefined) deliveries.push(retried);
        }
      }
      return {
        job: await completeBackgroundJob(this.repository, job),
        deliveries,
      };
    } catch (error) {
      await failBackgroundJob(
        this.repository,
        job,
        "notification_retry_failed",
      );
      throw error;
    }
  }

  private async retryDeliveryForUser(
    user: User,
    delivery: NotificationDelivery,
    policy: NotificationPolicy,
  ): Promise<NotificationDelivery | undefined> {
    const [notifications, channels] = await Promise.all([
      this.repository.listUserNotifications(user.orgId, user.id),
      this.repository.listNotificationDeliveryChannels(user.orgId, user.id),
    ]);
    const notification = notifications.find(
      (item) => item.id === delivery.notificationId,
    );
    const channel = channels.find((item) => item.id === delivery.channelId);
    if (notification === undefined || channel === undefined || !channel.enabled)
      return undefined;
    const blockReason = notificationPolicyBlockReason({
      policy,
      notificationType: notification.type,
      channel,
    });
    if (blockReason !== undefined) {
      return this.repository.updateNotificationDelivery(
        policyBlockedNotificationDelivery(delivery, blockReason),
      );
    }
    return this.deliverySender.retryDelivery({
      repository: this.repository,
      notification,
      channel,
      delivery,
    });
  }
}

export async function deliveryChannelsForNotification(input: {
  repository: RomeoRepository;
  orgId: string;
  userId: string;
  notification: UserNotification;
}): Promise<NotificationDeliveryChannel[]> {
  const [channels, policy] = await Promise.all([
    input.repository.listNotificationDeliveryChannels(
      input.orgId,
      input.userId,
    ),
    readNotificationPolicy(input.repository, input.orgId),
  ]);
  const enabledChannels = channels.filter((channel) => channel.enabled);
  const allowedChannels: NotificationDeliveryChannel[] = [];
  await Promise.all(
    enabledChannels.map(async (channel) => {
      const blockReason = notificationPolicyBlockReason({
        policy: policy.policy,
        notificationType: input.notification.type,
        channel,
      });
      if (blockReason === undefined) {
        allowedChannels.push(channel);
        return;
      }
      await createPolicyBlockedNotificationDelivery({
        repository: input.repository,
        notification: input.notification,
        channel,
        reason: blockReason,
      });
    }),
  );
  return allowedChannels;
}

function isDueRetry(delivery: NotificationDelivery, now: string): boolean {
  if (
    delivery.status !== "failed" ||
    delivery.attemptCount >= maxNotificationAttempts
  )
    return false;
  if (delivery.metadata.deadLetter !== undefined) return false;
  const nextAttemptAt = delivery.metadata.nextAttemptAt;
  return typeof nextAttemptAt !== "string" || nextAttemptAt <= now;
}

import { assertScope, type AuthSubject } from "@romeo/auth";

import {
  defaultNotificationPolicy,
  normalizeDomainList,
  normalizeHostAllowlist,
  normalizeNotificationTypeList,
  notificationChannelPolicyBlockReason,
  notificationPolicyBlockReason,
  notificationPolicyPosture,
  uniqueNotificationChannelTypes,
  uniqueNotificationTypes,
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
import { assertManagedSecretRef, parseManagedSecretRef } from "./secret-refs";
import { normalizeWebhookUrl } from "./webhook-url";

export interface NotificationRetryResult {
  job: BackgroundJob;
  deliveries: NotificationDelivery[];
}

export type PublicNotificationDeliveryChannel = Omit<
  NotificationDeliveryChannel,
  "config"
> & {
  config: Record<string, unknown>;
};

const policySettingKeyPrefix = "notification_policy.org.v1:";

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
      config: normalizeChannelConfig(input.type, input.config),
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
    if (isEmptyPolicyUpdate(input.policy)) {
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

export async function readNotificationPolicy(
  repository: RomeoRepository,
  orgId: string,
): Promise<NotificationPolicyReport> {
  const setting = await repository.getSystemSetting(policySettingKey(orgId));
  const value = setting?.value;
  const policy = normalizeStoredNotificationPolicy(value);
  return toNotificationPolicyReport(
    orgId,
    policy,
    stringField(value, "updatedAt") ?? setting?.updatedAt,
    stringField(value, "updatedBy"),
  );
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

function normalizeChannelConfig(
  type: NotificationDeliveryChannelType,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const enabledNotificationTypes = normalizeNotificationTypeList(
    config.enabledNotificationTypes,
  );
  if (type === "email") {
    const to = config.to;
    if (typeof to !== "string" || !isValidEmailAddress(to))
      throw new ApiError(
        "invalid_notification_channel",
        "Email notification channel requires a valid recipient email.",
        400,
      );
    return withEnabledNotificationTypes(
      { to: to.trim().toLowerCase() },
      enabledNotificationTypes,
    );
  }
  if (type === "mobile_push") {
    const tokenRef = config.tokenRef;
    if (typeof tokenRef !== "string" || tokenRef.trim().length === 0) {
      throw new ApiError(
        "invalid_notification_channel",
        "Mobile push notification channel requires a tokenRef secret reference.",
        400,
      );
    }
    assertManagedSecretRef(tokenRef.trim());
    const platform = mobilePushPlatform(config.platform);
    const collapseKey = mobilePushCollapseKey(config.collapseKey);
    return withEnabledNotificationTypes(
      {
        tokenRef: tokenRef.trim(),
        ...(platform === undefined ? {} : { platform }),
        ...(collapseKey === undefined ? {} : { collapseKey }),
      },
      enabledNotificationTypes,
    );
  }
  if (type === "pagerduty") {
    const routingKeyRef = config.routingKeyRef;
    if (
      typeof routingKeyRef !== "string" ||
      routingKeyRef.trim().length === 0
    ) {
      throw new ApiError(
        "invalid_notification_channel",
        "PagerDuty notification channel requires a routingKeyRef secret reference.",
        400,
      );
    }
    assertManagedSecretRef(routingKeyRef.trim());
    const severity = config.severity;
    return withEnabledNotificationTypes(
      {
        routingKeyRef: routingKeyRef.trim(),
        ...(isPagerDutySeverity(severity) ? { severity } : {}),
      },
      enabledNotificationTypes,
    );
  }
  if (type === "slack" || type === "teams" || type === "webhook") {
    const url = config.url;
    if (typeof url !== "string" || url.trim().length === 0)
      throw new ApiError(
        "invalid_notification_channel",
        "Notification channel requires a URL.",
        400,
      );
    return withEnabledNotificationTypes(
      { url: normalizeWebhookUrl(url) },
      enabledNotificationTypes,
    );
  }
  return withEnabledNotificationTypes({}, enabledNotificationTypes);
}

function toPublicNotificationDeliveryChannel(
  channel: NotificationDeliveryChannel,
): PublicNotificationDeliveryChannel {
  return {
    ...channel,
    config: publicChannelConfig(channel),
  };
}

function publicChannelConfig(
  channel: NotificationDeliveryChannel,
): Record<string, unknown> {
  const enabledNotificationTypes = normalizeNotificationTypeList(
    channel.config.enabledNotificationTypes,
  );
  const common =
    enabledNotificationTypes === undefined ? {} : { enabledNotificationTypes };
  if (channel.type === "email") {
    return {
      ...common,
      destinationConfigured: true,
      toDomain: emailDomain(channel.config.to) ?? "",
    };
  }
  if (
    channel.type === "webhook" ||
    channel.type === "slack" ||
    channel.type === "teams"
  ) {
    return {
      ...common,
      destinationConfigured: true,
      urlHost: urlHost(channel.config.url) ?? "",
    };
  }
  if (channel.type === "pagerduty") {
    return {
      ...common,
      routingKeyConfigured: true,
      routingKeyRefScheme: secretRefScheme(channel.config.routingKeyRef),
      ...(isPagerDutySeverity(channel.config.severity)
        ? { severity: channel.config.severity }
        : {}),
    };
  }
  if (channel.type === "mobile_push") {
    return {
      ...common,
      tokenConfigured: true,
      tokenRefScheme: secretRefScheme(channel.config.tokenRef),
      ...(mobilePushPlatform(channel.config.platform) === undefined
        ? {}
        : { platform: channel.config.platform }),
      ...(mobilePushCollapseKey(channel.config.collapseKey) === undefined
        ? {}
        : { collapseKey: channel.config.collapseKey }),
    };
  }
  return common;
}

function isPagerDutySeverity(
  value: unknown,
): value is "critical" | "error" | "info" | "warning" {
  return (
    value === "critical" ||
    value === "error" ||
    value === "info" ||
    value === "warning"
  );
}

function mobilePushPlatform(
  value: unknown,
): "android" | "ios" | "web" | undefined {
  return value === "android" || value === "ios" || value === "web"
    ? value
    : undefined;
}

function mobilePushCollapseKey(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return /^[A-Za-z0-9._:-]{1,64}$/u.test(trimmed) ? trimmed : undefined;
}

function isValidEmailAddress(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(trimmed);
}

function emailDomain(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const [, domain] = value.trim().toLowerCase().split("@");
  return typeof domain === "string" && domain.length > 0 ? domain : undefined;
}

function urlHost(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function secretRefScheme(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    return parseManagedSecretRef(value).scheme;
  } catch {
    return "";
  }
}

function withEnabledNotificationTypes(
  config: Record<string, unknown>,
  enabledNotificationTypes: ReturnType<typeof normalizeNotificationTypeList>,
): Record<string, unknown> {
  if (enabledNotificationTypes === undefined) return config;
  return { ...config, enabledNotificationTypes };
}

function policySettingKey(orgId: string): string {
  return `${policySettingKeyPrefix}${orgId}`;
}

function normalizeStoredNotificationPolicy(
  value: Record<string, unknown> | undefined,
): NotificationPolicy {
  const policy = isRecord(value?.policy) ? value.policy : value;
  const defaults = defaultNotificationPolicy();
  if (!isRecord(policy)) return defaults;
  return {
    deliveryEnabled:
      typeof policy.deliveryEnabled === "boolean"
        ? policy.deliveryEnabled
        : defaults.deliveryEnabled,
    allowedChannelTypes: uniqueNotificationChannelTypes(
      Array.isArray(policy.allowedChannelTypes)
        ? policy.allowedChannelTypes
        : defaults.allowedChannelTypes,
    ),
    allowedWebhookHosts: normalizeHostAllowlist(
      Array.isArray(policy.allowedWebhookHosts)
        ? policy.allowedWebhookHosts
        : defaults.allowedWebhookHosts,
    ),
    allowedSlackHosts: normalizeHostAllowlist(
      Array.isArray(policy.allowedSlackHosts)
        ? policy.allowedSlackHosts
        : defaults.allowedSlackHosts,
    ),
    allowedTeamsHosts: normalizeHostAllowlist(
      Array.isArray(policy.allowedTeamsHosts)
        ? policy.allowedTeamsHosts
        : defaults.allowedTeamsHosts,
    ),
    allowedEmailDomains: normalizeDomainList(
      Array.isArray(policy.allowedEmailDomains)
        ? policy.allowedEmailDomains
        : defaults.allowedEmailDomains,
    ),
    suppressedNotificationTypes: uniqueNotificationTypes(
      Array.isArray(policy.suppressedNotificationTypes)
        ? policy.suppressedNotificationTypes
        : defaults.suppressedNotificationTypes,
    ),
  };
}

function applyNotificationPolicyUpdate(
  existing: NotificationPolicy,
  update: UpdateNotificationPolicyRequest,
): NotificationPolicy {
  return {
    deliveryEnabled: update.deliveryEnabled ?? existing.deliveryEnabled,
    allowedChannelTypes:
      update.allowedChannelTypes === undefined
        ? existing.allowedChannelTypes
        : uniqueNotificationChannelTypes(update.allowedChannelTypes),
    allowedWebhookHosts:
      update.allowedWebhookHosts === undefined
        ? existing.allowedWebhookHosts
        : normalizeHostAllowlist(update.allowedWebhookHosts),
    allowedSlackHosts:
      update.allowedSlackHosts === undefined
        ? existing.allowedSlackHosts
        : normalizeHostAllowlist(update.allowedSlackHosts),
    allowedTeamsHosts:
      update.allowedTeamsHosts === undefined
        ? existing.allowedTeamsHosts
        : normalizeHostAllowlist(update.allowedTeamsHosts),
    allowedEmailDomains:
      update.allowedEmailDomains === undefined
        ? existing.allowedEmailDomains
        : normalizeDomainList(update.allowedEmailDomains),
    suppressedNotificationTypes:
      update.suppressedNotificationTypes === undefined
        ? existing.suppressedNotificationTypes
        : uniqueNotificationTypes(update.suppressedNotificationTypes),
  };
}

function toNotificationPolicyReport(
  orgId: string,
  policy: NotificationPolicy,
  updatedAt?: string,
  updatedBy?: string,
): NotificationPolicyReport {
  return {
    orgId,
    policy,
    posture: notificationPolicyPosture(policy),
    ...(updatedAt === undefined ? {} : { updatedAt }),
    ...(updatedBy === undefined ? {} : { updatedBy }),
  };
}

function notificationPolicyAuditMetadata(
  previous: NotificationPolicyReport,
  next: NotificationPolicyReport,
): Record<string, unknown> {
  return {
    deliveryEnabledChanged:
      previous.policy.deliveryEnabled !== next.policy.deliveryEnabled,
    allowedChannelTypeCount: next.policy.allowedChannelTypes.length,
    allowedWebhookHostCount: next.policy.allowedWebhookHosts.length,
    allowedSlackHostCount: next.policy.allowedSlackHosts.length,
    allowedTeamsHostCount: next.policy.allowedTeamsHosts.length,
    allowedEmailDomainCount: next.policy.allowedEmailDomains.length,
    suppressedNotificationTypeCount:
      next.policy.suppressedNotificationTypes.length,
    posture: next.posture,
  };
}

function isEmptyPolicyUpdate(update: UpdateNotificationPolicyRequest): boolean {
  return (
    update.deliveryEnabled === undefined &&
    update.allowedChannelTypes === undefined &&
    update.allowedWebhookHosts === undefined &&
    update.allowedSlackHosts === undefined &&
    update.allowedTeamsHosts === undefined &&
    update.allowedEmailDomains === undefined &&
    update.suppressedNotificationTypes === undefined
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(
  value: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const field = value?.[key];
  return typeof field === "string" && field.length > 0 ? field : undefined;
}

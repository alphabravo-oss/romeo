import {
  defaultNotificationPolicy,
  normalizeDomainList,
  normalizeHostAllowlist,
  notificationPolicyPosture,
  uniqueNotificationChannelTypes,
  uniqueNotificationTypes,
  type NotificationPolicy,
  type NotificationPolicyReport,
  type UpdateNotificationPolicyRequest,
} from "../domain/notification-policy";
import type { RomeoRepository } from "../domain/repository";
import type { AuditMetadata } from "./audit-log";

const policySettingKeyPrefix = "notification_policy.org.v1:";

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

export function policySettingKey(orgId: string): string {
  return `${policySettingKeyPrefix}${orgId}`;
}

export function applyNotificationPolicyUpdate(
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

export function toNotificationPolicyReport(
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

export function notificationPolicyAuditMetadata(
  previous: NotificationPolicyReport,
  next: NotificationPolicyReport,
): AuditMetadata<"admin.notification_policy.update"> {
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

export function isEmptyNotificationPolicyUpdate(
  update: UpdateNotificationPolicyRequest,
): boolean {
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

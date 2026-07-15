import type {
  NotificationDeliveryChannel,
  NotificationDeliveryChannelType,
  NotificationType,
} from "./entities";

export const notificationTypes: NotificationType[] = [
  "chat_mention",
  "support_impersonation_request_created",
  "support_impersonation_request_approved",
  "support_impersonation_request_rejected",
  "support_impersonation_session_created",
  "support_impersonation_session_revoked",
];
export const notificationDeliveryChannelTypes: NotificationDeliveryChannelType[] =
  ["email", "mobile_push", "pagerduty", "slack", "teams", "webhook"];

export interface NotificationPolicy {
  deliveryEnabled: boolean;
  allowedChannelTypes: NotificationDeliveryChannelType[];
  allowedWebhookHosts: string[];
  allowedSlackHosts: string[];
  allowedTeamsHosts: string[];
  allowedEmailDomains: string[];
  suppressedNotificationTypes: NotificationType[];
}

export interface NotificationPolicyPosture {
  deliveryEnabled: boolean;
  channelTypeRestrictionActive: boolean;
  webhookHostRestrictionActive: boolean;
  slackHostRestrictionActive: boolean;
  teamsHostRestrictionActive: boolean;
  emailDomainRestrictionActive: boolean;
  suppressedNotificationTypeCount: number;
}

export interface NotificationPolicyReport {
  orgId: string;
  policy: NotificationPolicy;
  posture: NotificationPolicyPosture;
  updatedAt?: string;
  updatedBy?: string;
}

export interface UpdateNotificationPolicyRequest {
  deliveryEnabled?: boolean | undefined;
  allowedChannelTypes?: NotificationDeliveryChannelType[] | undefined;
  allowedWebhookHosts?: string[] | undefined;
  allowedSlackHosts?: string[] | undefined;
  allowedTeamsHosts?: string[] | undefined;
  allowedEmailDomains?: string[] | undefined;
  suppressedNotificationTypes?: NotificationType[] | undefined;
}

export type NotificationPolicyBlockReason =
  | "notification_channel_type_blocked_by_policy"
  | "notification_delivery_disabled_by_policy"
  | "notification_destination_domain_blocked_by_policy"
  | "notification_destination_host_blocked_by_policy"
  | "notification_type_suppressed_by_channel"
  | "notification_type_suppressed_by_policy";

export function defaultNotificationPolicy(): NotificationPolicy {
  return {
    deliveryEnabled: true,
    allowedChannelTypes: [...notificationDeliveryChannelTypes],
    allowedWebhookHosts: [],
    allowedSlackHosts: [],
    allowedTeamsHosts: [],
    allowedEmailDomains: [],
    suppressedNotificationTypes: [],
  };
}

export function notificationPolicyPosture(
  policy: NotificationPolicy,
): NotificationPolicyPosture {
  return {
    deliveryEnabled: policy.deliveryEnabled,
    channelTypeRestrictionActive:
      policy.allowedChannelTypes.length <
      notificationDeliveryChannelTypes.length,
    webhookHostRestrictionActive: policy.allowedWebhookHosts.length > 0,
    slackHostRestrictionActive: policy.allowedSlackHosts.length > 0,
    teamsHostRestrictionActive: policy.allowedTeamsHosts.length > 0,
    emailDomainRestrictionActive: policy.allowedEmailDomains.length > 0,
    suppressedNotificationTypeCount: policy.suppressedNotificationTypes.length,
  };
}

export function notificationPolicyBlockReason(input: {
  policy: NotificationPolicy;
  notificationType: NotificationType;
  channel: NotificationDeliveryChannel;
}): NotificationPolicyBlockReason | undefined {
  if (!input.policy.deliveryEnabled)
    return "notification_delivery_disabled_by_policy";
  if (input.policy.suppressedNotificationTypes.includes(input.notificationType))
    return "notification_type_suppressed_by_policy";
  const channelReason = notificationChannelPolicyBlockReason({
    policy: input.policy,
    channel: input.channel,
  });
  if (channelReason !== undefined) return channelReason;
  if (!channelAllowsNotificationType(input.channel, input.notificationType))
    return "notification_type_suppressed_by_channel";

  return undefined;
}

export function notificationChannelPolicyBlockReason(input: {
  policy: NotificationPolicy;
  channel: NotificationDeliveryChannel;
}): NotificationPolicyBlockReason | undefined {
  if (!input.policy.allowedChannelTypes.includes(input.channel.type))
    return "notification_channel_type_blocked_by_policy";

  if (input.channel.type === "email") {
    const domain = emailDomain(input.channel.config.to);
    if (
      input.policy.allowedEmailDomains.length > 0 &&
      (domain === undefined ||
        !input.policy.allowedEmailDomains.includes(domain))
    ) {
      return "notification_destination_domain_blocked_by_policy";
    }
  }

  if (
    input.channel.type === "slack" ||
    input.channel.type === "teams" ||
    input.channel.type === "webhook"
  ) {
    const host = urlHost(input.channel.config.url);
    const allowedHosts =
      input.channel.type === "slack"
        ? input.policy.allowedSlackHosts
        : input.channel.type === "teams"
          ? input.policy.allowedTeamsHosts
          : input.policy.allowedWebhookHosts;
    if (
      allowedHosts.length > 0 &&
      (host === undefined || !hostMatchesAllowlist(host, allowedHosts))
    ) {
      return "notification_destination_host_blocked_by_policy";
    }
  }

  return undefined;
}

export function normalizeNotificationTypeList(
  value: unknown,
): NotificationType[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return uniqueNotificationTypes(value);
}

export function uniqueNotificationTypes(values: unknown[]): NotificationType[] {
  const allowed = new Set(notificationTypes);
  return [
    ...new Set(
      values.filter((value): value is NotificationType => {
        return (
          typeof value === "string" && allowed.has(value as NotificationType)
        );
      }),
    ),
  ];
}

export function uniqueNotificationChannelTypes(
  values: unknown[],
): NotificationDeliveryChannelType[] {
  const allowed = new Set(notificationDeliveryChannelTypes);
  return [
    ...new Set(
      values.filter((value): value is NotificationDeliveryChannelType => {
        return (
          typeof value === "string" &&
          allowed.has(value as NotificationDeliveryChannelType)
        );
      }),
    ),
  ];
}

export function normalizeDomainList(values: unknown[]): string[] {
  return [
    ...new Set(values.map((value) => normalizeDomain(value)).filter(isString)),
  ].sort();
}

export function normalizeHostAllowlist(values: unknown[]): string[] {
  return [
    ...new Set(
      values.map((value) => normalizeHostPattern(value)).filter(isString),
    ),
  ].sort();
}

function channelAllowsNotificationType(
  channel: NotificationDeliveryChannel,
  notificationType: NotificationType,
): boolean {
  const enabledTypes = normalizeNotificationTypeList(
    channel.config.enabledNotificationTypes,
  );
  return enabledTypes === undefined || enabledTypes.includes(notificationType);
}

function emailDomain(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const [, domain] = value.trim().toLowerCase().split("@");
  return normalizeDomain(domain);
}

function urlHost(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function hostMatchesAllowlist(host: string, allowlist: string[]): boolean {
  return allowlist.some((pattern) => {
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(1);
      return host.endsWith(suffix) && host.length > suffix.length;
    }
    return host === pattern;
  });
}

function normalizeDomain(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length === 0 ||
    normalized.length > 253 ||
    normalized.includes("@") ||
    normalized.includes("/") ||
    normalized.includes(":") ||
    normalized.startsWith(".") ||
    normalized.endsWith(".")
  ) {
    return undefined;
  }
  return normalized;
}

function normalizeHostPattern(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith("*.")) {
    const domain = normalizeDomain(normalized.slice(2));
    return domain === undefined ? undefined : `*.${domain}`;
  }
  return normalizeDomain(normalized);
}

function isString(value: string | undefined): value is string {
  return value !== undefined;
}

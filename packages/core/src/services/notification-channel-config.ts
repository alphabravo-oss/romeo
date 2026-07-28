import { normalizeNotificationTypeList } from "../domain/notification-policy";
import type {
  NotificationDeliveryChannel,
  NotificationDeliveryChannelType,
  NotificationType,
} from "../domain/entities";
import { ApiError } from "../errors";
import { assertManagedSecretRef, parseManagedSecretRef } from "./secret-refs";
import { normalizeWebhookUrl } from "./webhook-url";

type PublicNotificationChannelConfig = {
  enabledNotificationTypes?: NotificationType[];
} & (
  | { destinationConfigured: boolean; toDomain: string }
  | { destinationConfigured: boolean; urlHost: string }
  | {
      tokenConfigured: boolean;
      tokenRefScheme: string;
      platform?: "android" | "ios" | "web";
      collapseKey?: string;
    }
  | {
      routingKeyConfigured: boolean;
      routingKeyRefScheme: string;
      severity?: "critical" | "error" | "info" | "warning";
    }
);

export type PublicNotificationDeliveryChannel = Omit<
  NotificationDeliveryChannel,
  "config"
> & {
  config: PublicNotificationChannelConfig;
};

export function normalizeNotificationChannelConfig(
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

export function toPublicNotificationDeliveryChannel(
  channel: NotificationDeliveryChannel,
): PublicNotificationDeliveryChannel {
  return { ...channel, config: publicChannelConfig(channel) };
}

function publicChannelConfig(
  channel: NotificationDeliveryChannel,
): PublicNotificationChannelConfig {
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
    const platform = mobilePushPlatform(channel.config.platform);
    const collapseKey = mobilePushCollapseKey(channel.config.collapseKey);
    return {
      ...common,
      tokenConfigured: true,
      tokenRefScheme: secretRefScheme(channel.config.tokenRef),
      ...(platform === undefined ? {} : { platform }),
      ...(collapseKey === undefined ? {} : { collapseKey }),
    };
  }
  throw new Error("Unsupported notification channel type.");
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

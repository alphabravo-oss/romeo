import type {
  NotificationDelivery,
  NotificationDeliveryChannel,
  UserNotification,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import {
  baseDelivery,
  failedDelivery,
  sentDelivery,
  stringMetadata,
  type NotificationDeliverySender,
} from "./notification-delivery";
import type { SecretResolver } from "./secret-resolver";
import { parseManagedSecretRef } from "./secret-refs";
import { normalizeWebhookUrl } from "./webhook-url";

type PagerDutySeverity = "critical" | "error" | "info" | "warning";

export class TeamsWebhookNotificationDeliverySender implements NotificationDeliverySender {
  private readonly timeoutMs: number;

  constructor(
    private readonly options: {
      fetchImpl?: typeof fetch;
      timeoutMs?: number;
    } = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async createDelivery(input: {
    repository: RomeoRepository;
    notification: UserNotification;
    channel: NotificationDeliveryChannel;
  }): Promise<NotificationDelivery> {
    const delivery = await input.repository.createNotificationDelivery(
      baseDelivery(input.notification, input.channel, { status: "pending" }),
    );
    return this.attemptDelivery(
      input.repository,
      input.notification,
      input.channel,
      delivery,
    );
  }

  retryDelivery(input: {
    repository: RomeoRepository;
    notification: UserNotification;
    channel: NotificationDeliveryChannel;
    delivery: NotificationDelivery;
  }): Promise<NotificationDelivery> {
    return this.attemptDelivery(
      input.repository,
      input.notification,
      input.channel,
      input.delivery,
    );
  }

  private async attemptDelivery(
    repository: RomeoRepository,
    notification: UserNotification,
    channel: NotificationDeliveryChannel,
    delivery: NotificationDelivery,
  ): Promise<NotificationDelivery> {
    if (channel.type !== "teams") {
      return repository.updateNotificationDelivery(
        failedDelivery(delivery, "notification_channel_type_unsupported", {
          provider: "teams",
          expectedChannelType: "teams",
        }),
      );
    }

    const url =
      typeof channel.config.url === "string" ? channel.config.url : undefined;
    if (url === undefined) {
      return repository.updateNotificationDelivery(
        failedDelivery(delivery, "notification_channel_url_missing", {
          provider: "teams",
        }),
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await (this.options.fetchImpl ?? fetch)(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "Romeo-Notifications/0.1",
        },
        signal: controller.signal,
        body: JSON.stringify(teamsMessageCard(notification)),
      });
      return repository.updateNotificationDelivery(
        response.ok
          ? sentDelivery(delivery, {
              provider: "teams",
              responseStatus: response.status,
            })
          : failedDelivery(
              delivery,
              "http_error",
              { provider: "teams", responseStatus: response.status },
              { retryable: true },
            ),
      );
    } catch {
      return repository.updateNotificationDelivery(
        failedDelivery(
          delivery,
          "network_error",
          { provider: "teams" },
          { retryable: true },
        ),
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class PagerDutyEventsNotificationDeliverySender implements NotificationDeliverySender {
  private readonly endpoint: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly options: {
      eventsUrl: string;
      fetchImpl?: typeof fetch;
      secretResolver: SecretResolver;
      timeoutMs?: number;
    },
  ) {
    this.endpoint = normalizeWebhookUrl(options.eventsUrl);
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async createDelivery(input: {
    repository: RomeoRepository;
    notification: UserNotification;
    channel: NotificationDeliveryChannel;
  }): Promise<NotificationDelivery> {
    const delivery = await input.repository.createNotificationDelivery(
      baseDelivery(input.notification, input.channel, { status: "pending" }),
    );
    return this.attemptDelivery(
      input.repository,
      input.notification,
      input.channel,
      delivery,
    );
  }

  retryDelivery(input: {
    repository: RomeoRepository;
    notification: UserNotification;
    channel: NotificationDeliveryChannel;
    delivery: NotificationDelivery;
  }): Promise<NotificationDelivery> {
    return this.attemptDelivery(
      input.repository,
      input.notification,
      input.channel,
      input.delivery,
    );
  }

  private async attemptDelivery(
    repository: RomeoRepository,
    notification: UserNotification,
    channel: NotificationDeliveryChannel,
    delivery: NotificationDelivery,
  ): Promise<NotificationDelivery> {
    if (channel.type !== "pagerduty") {
      return repository.updateNotificationDelivery(
        failedDelivery(delivery, "notification_channel_type_unsupported", {
          provider: "pagerduty",
          expectedChannelType: "pagerduty",
        }),
      );
    }

    const routingKeyRef =
      typeof channel.config.routingKeyRef === "string"
        ? channel.config.routingKeyRef.trim()
        : undefined;
    if (routingKeyRef === undefined || routingKeyRef.length === 0) {
      return repository.updateNotificationDelivery(
        failedDelivery(
          delivery,
          "notification_channel_pagerduty_routing_key_ref_missing",
          { provider: "pagerduty" },
        ),
      );
    }

    const routingKey = await this.resolveRoutingKey(routingKeyRef);
    if (routingKey.value === undefined) {
      return repository.updateNotificationDelivery(
        failedDelivery(
          delivery,
          "pagerduty_routing_key_unavailable",
          {
            provider: "pagerduty",
            secretRefScheme: routingKey.scheme,
            ...(routingKey.failureCode === undefined
              ? {}
              : { secretFailureCode: routingKey.failureCode }),
          },
          { retryable: routingKey.retryable },
        ),
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await (this.options.fetchImpl ?? fetch)(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "Romeo-Notifications/0.1",
        },
        signal: controller.signal,
        body: JSON.stringify(
          pagerDutyEventPayload(
            notification,
            routingKey.value,
            pagerDutySeverity(channel.config.severity),
          ),
        ),
      });
      return repository.updateNotificationDelivery(
        response.ok
          ? sentDelivery(delivery, {
              provider: "pagerduty",
              responseStatus: response.status,
            })
          : failedDelivery(
              delivery,
              "http_error",
              { provider: "pagerduty", responseStatus: response.status },
              { retryable: true },
            ),
      );
    } catch {
      return repository.updateNotificationDelivery(
        failedDelivery(
          delivery,
          "network_error",
          { provider: "pagerduty" },
          { retryable: true },
        ),
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async resolveRoutingKey(secretRef: string): Promise<{
    failureCode?: string;
    retryable: boolean;
    scheme: string;
    value?: string;
  }> {
    let scheme: string;
    try {
      scheme = parseManagedSecretRef(secretRef).scheme;
    } catch {
      return {
        failureCode: "invalid_secret_ref",
        retryable: false,
        scheme: "",
      };
    }
    const resolution =
      await this.options.secretResolver.resolveValue?.(secretRef);
    if (resolution?.available === true && resolution.value !== undefined) {
      return {
        retryable: false,
        scheme: resolution.scheme,
        value: resolution.value,
      };
    }
    return {
      failureCode:
        resolution?.failureCode ?? "secret_value_resolution_unavailable",
      retryable: isRetryableSecretFailure(resolution?.failureCode),
      scheme: resolution?.scheme ?? scheme,
    };
  }
}

function teamsMessageCard(
  notification: UserNotification,
): Record<string, unknown> {
  return {
    "@type": "MessageCard",
    "@context": "https://schema.org/extensions",
    summary: `Romeo notification ${notification.id}`,
    themeColor: "2F6FED",
    sections: [
      {
        activityTitle: "Romeo notification",
        facts: notificationFacts(notification),
      },
    ],
  };
}

function pagerDutyEventPayload(
  notification: UserNotification,
  routingKey: string,
  severity: PagerDutySeverity,
): Record<string, unknown> {
  return {
    routing_key: routingKey,
    event_action: "trigger",
    dedup_key: `romeo:${notification.id}`,
    payload: {
      summary: `Romeo ${notification.type} ${notification.id}`,
      source: "romeo",
      severity,
      custom_details: {
        notificationId: notification.id,
        notificationType: notification.type,
        resourceType: notification.resourceType,
        resourceId: notification.resourceId,
        actorId: notification.actorId,
        chatId: stringMetadata(notification.metadata.chatId),
        commentId: stringMetadata(notification.metadata.commentId),
      },
    },
  };
}

function notificationFacts(notification: UserNotification): Array<{
  name: string;
  value: string;
}> {
  return [
    { name: "Notification", value: notification.id },
    { name: "Type", value: notification.type },
    {
      name: "Resource",
      value: `${notification.resourceType}:${notification.resourceId}`,
    },
    { name: "Actor", value: notification.actorId },
    { name: "Chat", value: stringMetadata(notification.metadata.chatId) ?? "" },
    {
      name: "Comment",
      value: stringMetadata(notification.metadata.commentId) ?? "",
    },
  ];
}

function pagerDutySeverity(value: unknown): PagerDutySeverity {
  return value === "critical" ||
    value === "error" ||
    value === "info" ||
    value === "warning"
    ? value
    : "info";
}

function isRetryableSecretFailure(failureCode: string | undefined): boolean {
  return (
    failureCode === "secret_resolver_error" ||
    failureCode === "secret_resolver_timeout"
  );
}

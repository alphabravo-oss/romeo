import {
  IncomingWebhook,
  IncomingWebhookHTTPError,
  type FetchFunction as SlackFetchFunction,
} from "@slack/webhook";
import { Resend } from "resend";

import type {
  NotificationDelivery,
  NotificationDeliveryChannel,
  UserNotification,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { deriveWebhookSecret, signWebhookPayload } from "./webhook-signing";
import { normalizeWebhookUrl } from "./webhook-url";
import {
  baseDelivery,
  failedDelivery,
  notificationText,
  sentDelivery,
  stringMetadata,
  withNotificationTimeout,
  type NotificationDeliverySender,
} from "./notification-delivery-core";

export * from "./notification-delivery-core";
export * from "./notification-delivery-smtp";
export interface ResendEmailClient {
  emails: Pick<Resend["emails"], "send">;
}
export type ResendEmailClientFactory = (
  apiKey: string,
  options: { baseUrl: string; userAgent: string },
) => ResendEmailClient;

export class WebhookNotificationDeliverySender implements NotificationDeliverySender {
  constructor(
    private readonly options: { fetchImpl?: typeof fetch; signingKey: string },
  ) {}

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
    if (channel.type !== "webhook") {
      return repository.updateNotificationDelivery(
        failedDelivery(delivery, "notification_channel_type_unsupported", {
          provider: "webhook",
          expectedChannelType: "webhook",
        }),
      );
    }

    const url =
      typeof channel.config.url === "string" ? channel.config.url : undefined;
    if (url === undefined) {
      return repository.updateNotificationDelivery(
        failedDelivery(delivery, "notification_channel_url_missing"),
      );
    }

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({
      id: delivery.id,
      type: `notification.${notification.type}`,
      createdAt: delivery.createdAt,
      data: {
        notificationId: notification.id,
        notificationType: notification.type,
        userId: notification.userId,
        actorId: notification.actorId,
        resourceType: notification.resourceType,
        resourceId: notification.resourceId,
        chatId: stringMetadata(notification.metadata.chatId),
        commentId: stringMetadata(notification.metadata.commentId),
      },
    });
    const secret = await deriveWebhookSecret(
      this.options.signingKey,
      channel.id,
    );
    const signature = await signWebhookPayload(secret, timestamp, body);

    try {
      const response = await (this.options.fetchImpl ?? fetch)(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "Romeo-Notifications/0.1",
          "x-romeo-delivery": delivery.id,
          "x-romeo-event": `notification.${notification.type}`,
          "x-romeo-signature": signature,
          "x-romeo-timestamp": timestamp,
        },
        body,
      });
      return repository.updateNotificationDelivery(
        response.ok
          ? sentDelivery(delivery, { responseStatus: response.status })
          : failedDelivery(
              delivery,
              "http_error",
              { responseStatus: response.status },
              { retryable: true },
            ),
      );
    } catch {
      return repository.updateNotificationDelivery(
        failedDelivery(delivery, "network_error", {}, { retryable: true }),
      );
    }
  }
}

export class ResendEmailNotificationDeliverySender implements NotificationDeliverySender {
  private readonly client: ResendEmailClient;
  private readonly timeoutMs: number;

  constructor(
    private readonly options: {
      apiKey: string;
      baseUrl: string;
      clientFactory?: ResendEmailClientFactory;
      from: string;
      timeoutMs?: number;
    },
  ) {
    const clientFactory =
      options.clientFactory ??
      ((apiKey, clientOptions) => new Resend(apiKey, clientOptions));
    this.client = clientFactory(options.apiKey, {
      baseUrl: normalizeWebhookUrl(options.baseUrl),
      userAgent: "Romeo-Notifications/0.1",
    });
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
    if (channel.type !== "email") {
      return repository.updateNotificationDelivery(
        failedDelivery(delivery, "notification_channel_type_unsupported", {
          provider: "resend",
          expectedChannelType: "email",
        }),
      );
    }

    if (
      this.options.apiKey.trim().length === 0 ||
      this.options.from.trim().length === 0
    ) {
      return repository.updateNotificationDelivery(
        failedDelivery(delivery, "email_adapter_not_configured", {
          provider: "resend",
        }),
      );
    }

    const to =
      typeof channel.config.to === "string" &&
      channel.config.to.trim().length > 0
        ? channel.config.to.trim().toLowerCase()
        : undefined;
    if (to === undefined) {
      return repository.updateNotificationDelivery(
        failedDelivery(delivery, "notification_channel_email_missing", {
          provider: "resend",
        }),
      );
    }

    try {
      const response = await withNotificationTimeout(
        this.client.emails.send({
          from: this.options.from.trim(),
          to: [to],
          subject: `Romeo notification: ${notification.type}`,
          text: notificationText(notification),
        }),
        this.timeoutMs,
      );
      return repository.updateNotificationDelivery(
        response.error === null
          ? sentDelivery(delivery, {
              provider: "resend",
              responseStatus: 200,
            })
          : failedDelivery(
              delivery,
              "http_error",
              {
                provider: "resend",
                ...(response.error.statusCode === null
                  ? {}
                  : { responseStatus: response.error.statusCode }),
              },
              {
                retryable:
                  response.error.statusCode === null ||
                  response.error.statusCode === 429 ||
                  response.error.statusCode >= 500,
              },
            ),
      );
    } catch {
      return repository.updateNotificationDelivery(
        failedDelivery(
          delivery,
          "network_error",
          { provider: "resend" },
          { retryable: true },
        ),
      );
    }
  }
}

export class SlackWebhookNotificationDeliverySender implements NotificationDeliverySender {
  constructor(
    private readonly options: {
      fetchImpl?: typeof fetch;
      timeoutMs?: number;
    } = {},
  ) {}

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
    if (channel.type !== "slack") {
      return repository.updateNotificationDelivery(
        failedDelivery(delivery, "notification_channel_type_unsupported", {
          provider: "slack",
          expectedChannelType: "slack",
        }),
      );
    }

    const url =
      typeof channel.config.url === "string" ? channel.config.url : undefined;
    if (url === undefined) {
      return repository.updateNotificationDelivery(
        failedDelivery(delivery, "notification_channel_url_missing", {
          provider: "slack",
        }),
      );
    }

    try {
      const webhook = new IncomingWebhook(url, {
        ...(this.options.fetchImpl === undefined
          ? {}
          : {
              fetch: this.options.fetchImpl as unknown as SlackFetchFunction,
            }),
        timeout: this.options.timeoutMs ?? 10_000,
      });
      await webhook.send({ text: notificationText(notification) });
      return repository.updateNotificationDelivery(
        sentDelivery(delivery, {
          provider: "slack",
          responseStatus: 200,
        }),
      );
    } catch (error) {
      const responseStatus =
        error instanceof IncomingWebhookHTTPError
          ? error.statusCode
          : undefined;
      return repository.updateNotificationDelivery(
        failedDelivery(
          delivery,
          responseStatus === undefined ? "network_error" : "http_error",
          {
            provider: "slack",
            ...(responseStatus === undefined ? {} : { responseStatus }),
          },
          { retryable: true },
        ),
      );
    }
  }
}

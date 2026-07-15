import nodemailer from "nodemailer";

import type {
  NotificationDelivery,
  NotificationDeliveryChannel,
  UserNotification,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { createId } from "../ids";
import { deriveWebhookSecret, signWebhookPayload } from "./webhook-signing";
import { normalizeWebhookUrl } from "./webhook-url";

export interface SmtpMailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
}

export type SmtpSendMail = (message: SmtpMailMessage) => Promise<unknown>;

export interface NotificationDeliverySender {
  createDelivery(input: {
    repository: RomeoRepository;
    notification: UserNotification;
    channel: NotificationDeliveryChannel;
  }): Promise<NotificationDelivery>;
  retryDelivery(input: {
    repository: RomeoRepository;
    notification: UserNotification;
    channel: NotificationDeliveryChannel;
    delivery: NotificationDelivery;
  }): Promise<NotificationDelivery>;
}

export class RoutingNotificationDeliverySender implements NotificationDeliverySender {
  constructor(
    private readonly senders: Partial<
      Record<NotificationDeliveryChannel["type"], NotificationDeliverySender>
    >,
  ) {}

  createDelivery(input: {
    repository: RomeoRepository;
    notification: UserNotification;
    channel: NotificationDeliveryChannel;
  }): Promise<NotificationDelivery> {
    return this.senderFor(input.channel).createDelivery(input);
  }

  retryDelivery(input: {
    repository: RomeoRepository;
    notification: UserNotification;
    channel: NotificationDeliveryChannel;
    delivery: NotificationDelivery;
  }): Promise<NotificationDelivery> {
    return this.senderFor(input.channel).retryDelivery(input);
  }

  private senderFor(
    channel: NotificationDeliveryChannel,
  ): NotificationDeliverySender {
    return this.senders[channel.type] ?? disabledNotificationDeliverySender;
  }
}

export const disabledNotificationDeliverySender: NotificationDeliverySender = {
  createDelivery({ repository, notification, channel }) {
    return repository.createNotificationDelivery(
      baseDelivery(notification, channel, {
        status: "disabled",
        errorCode: "delivery_adapter_not_configured",
      }),
    );
  },
  retryDelivery({ repository, delivery }) {
    return repository.updateNotificationDelivery(
      failedDelivery(delivery, "delivery_adapter_not_configured"),
    );
  },
};

export async function createPolicyBlockedNotificationDelivery(input: {
  repository: RomeoRepository;
  notification: UserNotification;
  channel: NotificationDeliveryChannel;
  reason: string;
}): Promise<NotificationDelivery> {
  return input.repository.createNotificationDelivery(
    baseDelivery(input.notification, input.channel, {
      status: "disabled",
      errorCode: input.reason,
      metadata: { policyBlocked: true },
    }),
  );
}

export function policyBlockedNotificationDelivery(
  delivery: NotificationDelivery,
  reason: string,
): NotificationDelivery {
  return {
    ...delivery,
    status: "disabled",
    errorCode: reason,
    metadata: clearRetryMetadata({
      ...delivery.metadata,
      policyBlocked: true,
    }),
    updatedAt: new Date().toISOString(),
  };
}

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
  private readonly endpoint: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly options: {
      apiKey: string;
      baseUrl: string;
      fetchImpl?: typeof fetch;
      from: string;
      timeoutMs?: number;
    },
  ) {
    this.endpoint = new URL(
      "/emails",
      normalizeWebhookUrl(options.baseUrl),
    ).toString();
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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await (this.options.fetchImpl ?? fetch)(this.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          "content-type": "application/json",
          "user-agent": "Romeo-Notifications/0.1",
        },
        signal: controller.signal,
        body: JSON.stringify({
          from: this.options.from.trim(),
          to: [to],
          subject: `Romeo notification: ${notification.type}`,
          text: notificationEmailText(notification),
        }),
      });
      return repository.updateNotificationDelivery(
        response.ok
          ? sentDelivery(delivery, {
              provider: "resend",
              responseStatus: response.status,
            })
          : failedDelivery(
              delivery,
              "http_error",
              { provider: "resend", responseStatus: response.status },
              { retryable: true },
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
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class SmtpEmailNotificationDeliverySender implements NotificationDeliverySender {
  private readonly timeoutMs: number;
  private readonly sendMail: SmtpSendMail;

  constructor(
    private readonly options: {
      from: string;
      host: string;
      password?: string;
      port: number;
      secure: boolean;
      sendMail?: SmtpSendMail;
      timeoutMs?: number;
      user?: string;
    },
  ) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.sendMail = options.sendMail ?? this.createSendMail();
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
          provider: "smtp",
          expectedChannelType: "email",
        }),
      );
    }

    if (
      this.options.host.trim().length === 0 ||
      this.options.from.trim().length === 0
    ) {
      return repository.updateNotificationDelivery(
        failedDelivery(delivery, "email_adapter_not_configured", {
          provider: "smtp",
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
          provider: "smtp",
        }),
      );
    }

    try {
      await this.sendMail({
        from: this.options.from.trim(),
        to,
        subject: `Romeo notification: ${notification.type}`,
        text: notificationEmailText(notification),
      });
      return repository.updateNotificationDelivery(
        sentDelivery(delivery, { provider: "smtp" }),
      );
    } catch {
      return repository.updateNotificationDelivery(
        failedDelivery(
          delivery,
          "smtp_error",
          { provider: "smtp" },
          { retryable: true },
        ),
      );
    }
  }

  private createSendMail(): SmtpSendMail {
    const transporter = nodemailer.createTransport({
      host: this.options.host,
      port: this.options.port,
      secure: this.options.secure,
      connectionTimeout: this.timeoutMs,
      greetingTimeout: this.timeoutMs,
      socketTimeout: this.timeoutMs,
      ...(this.options.user !== undefined && this.options.user.trim().length > 0
        ? {
            auth: {
              user: this.options.user,
              pass: this.options.password ?? "",
            },
          }
        : {}),
    });
    return (message) => transporter.sendMail(message);
  }
}

export class SlackWebhookNotificationDeliverySender implements NotificationDeliverySender {
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
        body: JSON.stringify({ text: notificationSlackText(notification) }),
      });
      return repository.updateNotificationDelivery(
        response.ok
          ? sentDelivery(delivery, {
              provider: "slack",
              responseStatus: response.status,
            })
          : failedDelivery(
              delivery,
              "http_error",
              { provider: "slack", responseStatus: response.status },
              { retryable: true },
            ),
      );
    } catch {
      return repository.updateNotificationDelivery(
        failedDelivery(
          delivery,
          "network_error",
          { provider: "slack" },
          { retryable: true },
        ),
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function baseDelivery(
  notification: UserNotification,
  channel: NotificationDeliveryChannel,
  fields: Pick<NotificationDelivery, "status"> & {
    errorCode?: string | undefined;
    metadata?: Record<string, unknown> | undefined;
  },
): NotificationDelivery {
  const now = notification.createdAt;
  return {
    id: createId("notification_delivery"),
    orgId: notification.orgId,
    userId: notification.userId,
    notificationId: notification.id,
    channelId: channel.id,
    status: fields.status,
    attemptCount: 0,
    ...(fields.errorCode === undefined ? {} : { errorCode: fields.errorCode }),
    metadata: {
      notificationType: notification.type,
      channelType: channel.type,
      ...(fields.metadata ?? {}),
    },
    createdAt: now,
    updatedAt: now,
  };
}

export function sentDelivery(
  delivery: NotificationDelivery,
  metadata: Record<string, unknown> = {},
): NotificationDelivery {
  const now = new Date().toISOString();
  const updated: NotificationDelivery = {
    ...delivery,
    status: "sent",
    attemptCount: delivery.attemptCount + 1,
    metadata: clearRetryMetadata({ ...delivery.metadata, ...metadata }),
    updatedAt: now,
    deliveredAt: now,
  };
  delete updated.errorCode;
  return updated;
}

export function failedDelivery(
  delivery: NotificationDelivery,
  errorCode: string,
  metadata: Record<string, unknown> = {},
  options: { retryable?: boolean } = {},
): NotificationDelivery {
  const attemptCount = delivery.attemptCount + 1;
  return {
    ...delivery,
    status: "failed",
    attemptCount,
    errorCode,
    metadata: withRetryMetadata(
      { ...delivery.metadata, ...metadata },
      attemptCount,
      options.retryable === true,
    ),
    updatedAt: new Date().toISOString(),
  };
}

function withRetryMetadata(
  metadata: Record<string, unknown>,
  attemptCount: number,
  retryable: boolean,
): Record<string, unknown> {
  const cleared = clearRetryMetadata(metadata);
  if (!retryable) return cleared;
  if (attemptCount >= maxNotificationAttempts) {
    return {
      ...cleared,
      deadLetter: { reason: "max_attempts_exhausted", attemptCount },
    };
  }
  return {
    ...cleared,
    nextAttemptAt: nextNotificationRetryAt(attemptCount),
  };
}

function clearRetryMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const {
    nextAttemptAt: _nextAttemptAt,
    deadLetter: _deadLetter,
    ...rest
  } = metadata;
  return rest;
}

function nextNotificationRetryAt(attemptCount: number): string {
  const delaySeconds = Math.min(3600, 60 * 2 ** Math.max(0, attemptCount - 1));
  return new Date(Date.now() + delaySeconds * 1000).toISOString();
}

export function stringMetadata(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function notificationEmailText(notification: UserNotification): string {
  return [
    `Romeo notification ${notification.id}`,
    `Type: ${notification.type}`,
    `Resource: ${notification.resourceType}:${notification.resourceId}`,
    `Actor: ${notification.actorId}`,
    `Chat: ${stringMetadata(notification.metadata.chatId) ?? ""}`,
    `Comment: ${stringMetadata(notification.metadata.commentId) ?? ""}`,
  ].join("\n");
}

function notificationSlackText(notification: UserNotification): string {
  return [
    `Romeo notification ${notification.id}`,
    `Type: ${notification.type}`,
    `Resource: ${notification.resourceType}:${notification.resourceId}`,
    `Actor: ${notification.actorId}`,
    `Chat: ${stringMetadata(notification.metadata.chatId) ?? ""}`,
    `Comment: ${stringMetadata(notification.metadata.commentId) ?? ""}`,
  ].join("\n");
}

export const maxNotificationAttempts = 5;

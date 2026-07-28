import nodemailer from "nodemailer";

import type {
  NotificationDelivery,
  NotificationDeliveryChannel,
  UserNotification,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import {
  baseDelivery,
  failedDelivery,
  notificationText,
  sentDelivery,
  type NotificationDeliverySender,
} from "./notification-delivery-core";

export interface SmtpMailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
}

export type SmtpSendMail = (message: SmtpMailMessage) => Promise<unknown>;

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
        text: notificationText(notification),
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

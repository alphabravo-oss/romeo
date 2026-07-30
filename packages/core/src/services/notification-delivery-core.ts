import type {
  NotificationDelivery,
  NotificationDeliveryChannel,
  UserNotification,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { createId } from "../ids";

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

  createDelivery(
    input: Parameters<NotificationDeliverySender["createDelivery"]>[0],
  ) {
    return this.senderFor(input.channel).createDelivery(input);
  }

  retryDelivery(
    input: Parameters<NotificationDeliverySender["retryDelivery"]>[0],
  ) {
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
    metadata: clearRetryMetadata({ ...delivery.metadata, policyBlocked: true }),
    updatedAt: new Date().toISOString(),
  };
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
      ...fields.metadata,
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

export function stringMetadata(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function notificationText(notification: UserNotification): string {
  return [
    `Romeo notification ${notification.id}`,
    `Type: ${notification.type}`,
    `Resource: ${notification.resourceType}:${notification.resourceId}`,
    `Actor: ${notification.actorId}`,
    `Chat: ${stringMetadata(notification.metadata.chatId) ?? ""}`,
    `Comment: ${stringMetadata(notification.metadata.commentId) ?? ""}`,
  ].join("\n");
}

export async function withNotificationTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("notification_delivery_timeout")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function withRetryMetadata(
  metadata: Record<string, unknown>,
  attemptCount: number,
  retryable: boolean,
): Record<string, unknown> {
  const cleared = clearRetryMetadata(metadata);
  if (!retryable) return cleared;
  if (attemptCount >= maxNotificationAttempts)
    return {
      ...cleared,
      deadLetter: { reason: "max_attempts_exhausted", attemptCount },
    };
  return { ...cleared, nextAttemptAt: nextNotificationRetryAt(attemptCount) };
}

function clearRetryMetadata(metadata: Record<string, unknown>) {
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

export const maxNotificationAttempts = 5;

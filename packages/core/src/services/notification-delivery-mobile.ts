import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import {
  FirebaseMessagingError,
  getMessaging,
  type Message,
  type Messaging,
} from "firebase-admin/messaging";
import { createHash } from "node:crypto";

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

type MobilePushPlatform = "android" | "ios" | "web";

interface FcmServiceAccount {
  clientEmail: string;
  privateKey: string;
  projectId?: string;
}

export interface FcmMessagingClient {
  send: Messaging["send"];
}

export type FcmMessagingClientFactory = (input: {
  projectId: string;
  serviceAccount: FcmServiceAccount;
}) => FcmMessagingClient;

export class FcmMobilePushNotificationDeliverySender implements NotificationDeliverySender {
  private readonly clientFactory: FcmMessagingClientFactory;
  private readonly timeoutMs: number;

  constructor(
    private readonly options: {
      clientFactory?: FcmMessagingClientFactory;
      projectId: string;
      secretResolver: SecretResolver;
      serviceAccountRef: string;
      timeoutMs?: number;
    },
  ) {
    this.clientFactory = options.clientFactory ?? firebaseMessagingClient;
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
    if (channel.type !== "mobile_push") {
      return repository.updateNotificationDelivery(
        failedDelivery(delivery, "notification_channel_type_unsupported", {
          provider: "fcm",
          expectedChannelType: "mobile_push",
        }),
      );
    }

    const tokenRef = stringConfig(channel.config.tokenRef);
    if (tokenRef === undefined) {
      return repository.updateNotificationDelivery(
        failedDelivery(
          delivery,
          "notification_channel_mobile_push_token_ref_missing",
          { provider: "fcm" },
        ),
      );
    }
    const tokenSecret = await this.resolveSecret(tokenRef);
    if (tokenSecret.value === undefined) {
      return repository.updateNotificationDelivery(
        failedDelivery(
          delivery,
          "mobile_push_token_unavailable",
          secretFailureMetadata(tokenSecret, "secretRefScheme"),
          { retryable: tokenSecret.retryable },
        ),
      );
    }
    const registrationToken = pushTokenValue(tokenSecret.value);
    if (registrationToken === undefined) {
      return repository.updateNotificationDelivery(
        failedDelivery(delivery, "mobile_push_token_invalid", {
          provider: "fcm",
          secretRefScheme: tokenSecret.scheme,
        }),
      );
    }

    const accountSecret = await this.resolveSecret(
      this.options.serviceAccountRef,
    );
    if (accountSecret.value === undefined) {
      return repository.updateNotificationDelivery(
        failedDelivery(
          delivery,
          "fcm_service_account_unavailable",
          secretFailureMetadata(accountSecret, "serviceAccountRefScheme"),
          { retryable: accountSecret.retryable },
        ),
      );
    }
    const serviceAccount = parseFcmServiceAccount(accountSecret.value);
    if (serviceAccount === undefined) {
      return repository.updateNotificationDelivery(
        failedDelivery(delivery, "fcm_service_account_invalid", {
          provider: "fcm",
          serviceAccountRefScheme: accountSecret.scheme,
        }),
      );
    }
    const projectId = fcmProjectId(
      this.options.projectId,
      serviceAccount.projectId,
    );
    if (projectId === undefined) {
      return repository.updateNotificationDelivery(
        failedDelivery(delivery, "fcm_project_id_missing_or_invalid", {
          provider: "fcm",
        }),
      );
    }

    const platform = mobilePushPlatform(channel.config.platform);
    try {
      const client = this.clientFactory({ projectId, serviceAccount });
      await withTimeout(
        client.send(
          fcmMessage(notification, registrationToken, channel.config),
        ),
        this.timeoutMs,
      );
      return repository.updateNotificationDelivery(
        sentDelivery(delivery, {
          provider: "fcm",
          ...(platform === undefined ? {} : { platform }),
          responseStatus: 200,
        }),
      );
    } catch (error) {
      const code = firebaseErrorCode(error);
      return repository.updateNotificationDelivery(
        failedDelivery(
          delivery,
          code === "notification_delivery_timeout"
            ? "network_error"
            : "fcm_send_failed",
          {
            provider: "fcm",
            ...(platform === undefined ? {} : { platform }),
            ...(code === undefined ? {} : { providerErrorCode: code }),
          },
          { retryable: isRetryableFirebaseError(code) },
        ),
      );
    }
  }

  private async resolveSecret(secretRef: string): Promise<ResolvedSecret> {
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
    if (this.options.secretResolver.resolveValue === undefined) {
      return {
        failureCode: "secret_value_resolution_unavailable",
        retryable: false,
        scheme,
      };
    }
    const resolution =
      await this.options.secretResolver.resolveValue(secretRef);
    if (resolution.available && resolution.value !== undefined) {
      return {
        retryable: false,
        scheme: resolution.scheme,
        value: resolution.value,
      };
    }
    return {
      failureCode:
        resolution.failureCode ?? "secret_value_resolution_unavailable",
      retryable: isRetryableSecretFailure(resolution.failureCode),
      scheme: resolution.scheme ?? scheme,
    };
  }
}

interface ResolvedSecret {
  failureCode?: string;
  retryable: boolean;
  scheme: string;
  value?: string;
}

function firebaseMessagingClient(input: {
  projectId: string;
  serviceAccount: FcmServiceAccount;
}): FcmMessagingClient {
  const appName = `romeo-fcm-${createHash("sha256")
    .update(input.projectId)
    .update("\0")
    .update(input.serviceAccount.clientEmail)
    .update("\0")
    .update(input.serviceAccount.privateKey)
    .digest("hex")
    .slice(0, 24)}`;
  const app =
    existingFirebaseApp(appName) ??
    initializeApp(
      {
        credential: cert({
          projectId: input.projectId,
          clientEmail: input.serviceAccount.clientEmail,
          privateKey: input.serviceAccount.privateKey,
        }),
        projectId: input.projectId,
      },
      appName,
    );
  return getMessaging(app);
}

function existingFirebaseApp(name: string): App | undefined {
  return getApps().find((app) => app.name === name);
}

function fcmMessage(
  notification: UserNotification,
  token: string,
  config: Record<string, unknown>,
): Message {
  const collapseKey = collapseKeyValue(config.collapseKey);
  return {
    token,
    notification: {
      title: "Romeo notification",
      body: notificationTitle(notification),
    },
    data: {
      notificationId: notification.id,
      notificationType: notification.type,
      resourceType: notification.resourceType,
      resourceId: notification.resourceId,
      actorId: notification.actorId,
      chatId: stringMetadata(notification.metadata.chatId) ?? "",
      commentId: stringMetadata(notification.metadata.commentId) ?? "",
    },
    ...(collapseKey === undefined
      ? {}
      : {
          android: { collapseKey },
          apns: { headers: { "apns-collapse-id": collapseKey } },
          webpush: { headers: { Topic: collapseKey } },
        }),
  };
}

function parseFcmServiceAccount(value: string): FcmServiceAccount | undefined {
  const parsed = parseJsonRecord(value);
  if (!isRecord(parsed)) return undefined;
  const clientEmail = stringField(parsed, "client_email");
  const privateKey = stringField(parsed, "private_key");
  if (clientEmail === undefined || privateKey === undefined) return undefined;
  const projectId = stringField(parsed, "project_id");
  return {
    clientEmail,
    privateKey: privateKey.replace(/\\n/gu, "\n"),
    ...(projectId === undefined ? {} : { projectId }),
  };
}

function pushTokenValue(value: string): string | undefined {
  const trimmed = value.trim();
  const parsed = parseJsonRecord(trimmed);
  const token = isRecord(parsed)
    ? (stringField(parsed, "token") ??
      stringField(parsed, "fcmToken") ??
      stringField(parsed, "registrationToken"))
    : trimmed;
  return token !== undefined &&
    token.length >= 10 &&
    token.length <= 4_096 &&
    !/\s/u.test(token)
    ? token
    : undefined;
}

function fcmProjectId(
  configuredProjectId: string,
  serviceAccountProjectId: string | undefined,
): string | undefined {
  const projectId = configuredProjectId.trim() || serviceAccountProjectId || "";
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(projectId)
    ? projectId
    : undefined;
}

function mobilePushPlatform(value: unknown): MobilePushPlatform | undefined {
  return value === "android" || value === "ios" || value === "web"
    ? value
    : undefined;
}

function collapseKeyValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return /^[A-Za-z0-9._:-]{1,64}$/u.test(trimmed) ? trimmed : undefined;
}

function notificationTitle(notification: UserNotification): string {
  return notification.type === "chat_mention"
    ? "You were mentioned in a chat."
    : "You have a new notification.";
}

function secretFailureMetadata(
  secret: ResolvedSecret,
  schemeKey: "secretRefScheme" | "serviceAccountRefScheme",
): Record<string, unknown> {
  return {
    provider: "fcm",
    [schemeKey]: secret.scheme,
    ...(secret.failureCode === undefined
      ? {}
      : { secretFailureCode: secret.failureCode }),
  };
}

async function withTimeout<T>(
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

function firebaseErrorCode(error: unknown): string | undefined {
  if (error instanceof FirebaseMessagingError) return error.code;
  return error instanceof Error ? error.message : undefined;
}

function isRetryableFirebaseError(code: string | undefined): boolean {
  return (
    code === undefined ||
    code === "notification_delivery_timeout" ||
    code === "messaging/internal-error" ||
    code === "messaging/server-unavailable" ||
    code === "messaging/unknown-error"
  );
}

function stringConfig(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function parseJsonRecord(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function stringField(
  record: Record<string, unknown>,
  field: string,
): string | undefined {
  return stringConfig(record[field]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRetryableSecretFailure(failureCode: string | undefined): boolean {
  return (
    failureCode === "secret_resolver_error" ||
    failureCode === "secret_resolver_timeout"
  );
}

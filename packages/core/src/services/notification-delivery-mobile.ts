import { createSign } from "node:crypto";

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

type MobilePushPlatform = "android" | "ios" | "web";

interface FcmServiceAccount {
  clientEmail: string;
  privateKey: string;
  projectId?: string;
}

interface CachedAccessToken {
  expiresAtMs: number;
  token: string;
}

const fcmScope = "https://www.googleapis.com/auth/firebase.messaging";

export class FcmMobilePushNotificationDeliverySender
  implements NotificationDeliverySender
{
  private accessToken: CachedAccessToken | undefined;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly tokenUrl: string;

  constructor(
    private readonly options: {
      baseUrl: string;
      fetchImpl?: typeof fetch;
      projectId: string;
      secretResolver: SecretResolver;
      serviceAccountRef: string;
      timeoutMs?: number;
      tokenUrl: string;
    },
  ) {
    this.baseUrl = normalizeWebhookUrl(options.baseUrl);
    this.tokenUrl = normalizeWebhookUrl(options.tokenUrl);
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

    const tokenRef =
      typeof channel.config.tokenRef === "string"
        ? channel.config.tokenRef.trim()
        : undefined;
    if (tokenRef === undefined || tokenRef.length === 0) {
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
          {
            provider: "fcm",
            secretRefScheme: tokenSecret.scheme,
            ...(tokenSecret.failureCode === undefined
              ? {}
              : { secretFailureCode: tokenSecret.failureCode }),
          },
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

    const serviceAccountSecret = await this.resolveSecret(
      this.options.serviceAccountRef,
    );
    if (serviceAccountSecret.value === undefined) {
      return repository.updateNotificationDelivery(
        failedDelivery(
          delivery,
          "fcm_service_account_unavailable",
          {
            provider: "fcm",
            serviceAccountRefScheme: serviceAccountSecret.scheme,
            ...(serviceAccountSecret.failureCode === undefined
              ? {}
              : {
                  serviceAccountFailureCode: serviceAccountSecret.failureCode,
                }),
          },
          { retryable: serviceAccountSecret.retryable },
        ),
      );
    }

    const serviceAccount = parseFcmServiceAccount(serviceAccountSecret.value);
    if (serviceAccount === undefined) {
      return repository.updateNotificationDelivery(
        failedDelivery(delivery, "fcm_service_account_invalid", {
          provider: "fcm",
          serviceAccountRefScheme: serviceAccountSecret.scheme,
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

    const accessToken = await this.fcmAccessToken(serviceAccount);
    if (accessToken.value === undefined) {
      return repository.updateNotificationDelivery(
        failedDelivery(
          delivery,
          accessToken.errorCode,
          { provider: "fcm", responseStatus: accessToken.responseStatus },
          { retryable: accessToken.retryable },
        ),
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await (this.options.fetchImpl ?? fetch)(
        fcmSendUrl(this.baseUrl, projectId),
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken.value}`,
            "content-type": "application/json",
            "user-agent": "Romeo-Notifications/0.1",
          },
          signal: controller.signal,
          body: JSON.stringify(
            fcmMessagePayload(notification, registrationToken, channel.config),
          ),
        },
      );
      const platform = mobilePushPlatform(channel.config.platform);
      return repository.updateNotificationDelivery(
        response.ok
          ? sentDelivery(delivery, {
              provider: "fcm",
              ...(platform === undefined ? {} : { platform }),
              responseStatus: response.status,
            })
          : failedDelivery(
              delivery,
              "http_error",
              {
                provider: "fcm",
                ...(platform === undefined ? {} : { platform }),
                responseStatus: response.status,
              },
              { retryable: isRetryableHttpStatus(response.status) },
            ),
      );
    } catch {
      return repository.updateNotificationDelivery(
        failedDelivery(
          delivery,
          "network_error",
          { provider: "fcm" },
          { retryable: true },
        ),
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fcmAccessToken(
    serviceAccount: FcmServiceAccount,
  ): Promise<{
    errorCode: string;
    responseStatus?: number;
    retryable: boolean;
    value?: string;
  }> {
    const nowMs = Date.now();
    if (
      this.accessToken !== undefined &&
      this.accessToken.expiresAtMs - 60_000 > nowMs
    ) {
      return {
        errorCode: "",
        retryable: false,
        value: this.accessToken.token,
      };
    }

    const assertion = signedServiceAccountJwt({
      audience: this.tokenUrl,
      clientEmail: serviceAccount.clientEmail,
      nowSeconds: Math.floor(nowMs / 1000),
      privateKey: serviceAccount.privateKey,
    });
    if (assertion === undefined) {
      return { errorCode: "fcm_service_account_invalid", retryable: false };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await (this.options.fetchImpl ?? fetch)(this.tokenUrl, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": "Romeo-Notifications/0.1",
        },
        signal: controller.signal,
        body: new URLSearchParams({
          assertion,
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        }),
      });
      if (!response.ok) {
        return {
          errorCode: "fcm_access_token_unavailable",
          responseStatus: response.status,
          retryable: isRetryableHttpStatus(response.status),
        };
      }
      const payload = await response.json().catch(() => undefined);
      const token =
        isRecord(payload) && typeof payload.access_token === "string"
          ? payload.access_token
          : undefined;
      if (token === undefined || token.trim().length === 0) {
        return {
          errorCode: "fcm_access_token_invalid",
          retryable: false,
        };
      }
      const expiresIn =
        isRecord(payload) && typeof payload.expires_in === "number"
          ? payload.expires_in
          : 3600;
      this.accessToken = {
        expiresAtMs: nowMs + Math.max(1, expiresIn) * 1000,
        token,
      };
      return { errorCode: "", retryable: false, value: token };
    } catch {
      return {
        errorCode: "fcm_access_token_network_error",
        retryable: true,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async resolveSecret(secretRef: string): Promise<{
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
    if (this.options.secretResolver.resolveValue === undefined) {
      return {
        failureCode: "secret_value_resolution_unavailable",
        retryable: false,
        scheme,
      };
    }
    const resolution = await this.options.secretResolver.resolveValue(secretRef);
    if (resolution.available === true && resolution.value !== undefined) {
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

function fcmMessagePayload(
  notification: UserNotification,
  token: string,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const collapseKey = collapseKeyValue(config.collapseKey);
  return {
    message: {
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
            android: { collapse_key: collapseKey },
            apns: { headers: { "apns-collapse-id": collapseKey } },
            webpush: { headers: { Topic: collapseKey } },
          }),
    },
  };
}

function signedServiceAccountJwt(input: {
  audience: string;
  clientEmail: string;
  nowSeconds: number;
  privateKey: string;
}): string | undefined {
  try {
    const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
    const claims = base64UrlJson({
      aud: input.audience,
      exp: input.nowSeconds + 3600,
      iat: input.nowSeconds,
      iss: input.clientEmail,
      scope: fcmScope,
    });
    const signingInput = `${header}.${claims}`;
    const signer = createSign("RSA-SHA256");
    signer.update(signingInput);
    signer.end();
    const signature = signer.sign(input.privateKey, "base64url");
    return `${signingInput}.${signature}`;
  } catch {
    return undefined;
  }
}

function base64UrlJson(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
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
    privateKey: privateKey.replace(/\\n/g, "\n"),
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
    token.length <= 4096 &&
    !/\s/u.test(token)
    ? token
    : undefined;
}

function fcmProjectId(
  configuredProjectId: string,
  serviceAccountProjectId: string | undefined,
): string | undefined {
  const projectId =
    configuredProjectId.trim() ||
    (serviceAccountProjectId === undefined ? "" : serviceAccountProjectId);
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(projectId)
    ? projectId
    : undefined;
}

function fcmSendUrl(baseUrl: string, projectId: string): string {
  return new URL(
    `/v1/projects/${encodeURIComponent(projectId)}/messages:send`,
    baseUrl,
  ).toString();
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
  const value = record[field];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function isRetryableSecretFailure(failureCode: string | undefined): boolean {
  return (
    failureCode === "secret_resolver_error" ||
    failureCode === "secret_resolver_timeout"
  );
}

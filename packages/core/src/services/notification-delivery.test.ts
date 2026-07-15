import { describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";

import type {
  NotificationDeliveryChannel,
  UserNotification,
} from "../domain/entities";
import { InMemoryRomeoRepository } from "../repositories/in-memory";
import {
  ResendEmailNotificationDeliverySender,
  SlackWebhookNotificationDeliverySender,
  SmtpEmailNotificationDeliverySender,
  WebhookNotificationDeliverySender,
} from "./notification-delivery";
import {
  PagerDutyEventsNotificationDeliverySender,
  TeamsWebhookNotificationDeliverySender,
} from "./notification-delivery-enterprise";
import { FcmMobilePushNotificationDeliverySender } from "./notification-delivery-mobile";

const now = "2026-01-01T00:00:00.000Z";

const notification: UserNotification = {
  id: "notification_test",
  orgId: "org_default",
  userId: "user_dev_admin",
  type: "chat_mention",
  actorId: "service_account_commenter",
  resourceType: "chat",
  resourceId: "chat_welcome",
  metadata: { chatId: "chat_welcome", commentId: "comment_test" },
  createdAt: now,
};

function channel(
  fields: Pick<NotificationDeliveryChannel, "id" | "type" | "config">,
): NotificationDeliveryChannel {
  return {
    id: fields.id,
    orgId: "org_default",
    userId: "user_dev_admin",
    name: fields.id,
    type: fields.type,
    config: fields.config,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

describe("notification delivery senders", () => {
  it("does not post to URL-backed channel types owned by other adapters", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok", { status: 200 }));
    const repository = new InMemoryRomeoRepository();

    const slackDelivery = await new SlackWebhookNotificationDeliverySender({
      fetchImpl,
    }).createDelivery({
      repository,
      notification,
      channel: channel({
        id: "channel_webhook",
        type: "webhook",
        config: { url: "https://example.com/hook" },
      }),
    });
    const webhookDelivery = await new WebhookNotificationDeliverySender({
      fetchImpl,
      signingKey: "test-signing-key",
    }).createDelivery({
      repository,
      notification,
      channel: channel({
        id: "channel_slack",
        type: "slack",
        config: { url: "https://hooks.slack.com/services/T/B/C" },
      }),
    });
    const emailDelivery = await new ResendEmailNotificationDeliverySender({
      apiKey: "resend-test-key",
      baseUrl: "https://api.resend.com",
      fetchImpl,
      from: "notify@romeo.example",
    }).createDelivery({
      repository,
      notification,
      channel: channel({
        id: "channel_slack_email",
        type: "slack",
        config: { to: "target@example.com" },
      }),
    });
    const smtpSendMail = vi.fn(async () => ({
      messageId: "smtp-secret-message-id",
    }));
    const smtpDelivery = await new SmtpEmailNotificationDeliverySender({
      from: "notify@romeo.example",
      host: "smtp.example.com",
      password: "smtp-secret-password",
      port: 587,
      secure: false,
      sendMail: smtpSendMail,
      user: "smtp-user",
    }).createDelivery({
      repository,
      notification,
      channel: channel({
        id: "channel_slack_smtp",
        type: "slack",
        config: { to: "target@example.com" },
      }),
    });
    const teamsDelivery = await new TeamsWebhookNotificationDeliverySender({
      fetchImpl,
    }).createDelivery({
      repository,
      notification,
      channel: channel({
        id: "channel_webhook_teams",
        type: "webhook",
        config: { url: "https://example.com/hook" },
      }),
    });
    const pagerDutySecretResolver = {
      check: vi.fn(),
      resolveValue: vi.fn(async () => ({
        available: true,
        scheme: "env",
        value: "pagerduty-secret-routing-key",
      })),
    };
    const pagerDutyDelivery =
      await new PagerDutyEventsNotificationDeliverySender({
        eventsUrl: "https://events.pagerduty.com/v2/enqueue",
        fetchImpl,
        secretResolver: pagerDutySecretResolver,
      }).createDelivery({
        repository,
        notification,
        channel: channel({
          id: "channel_slack_pagerduty",
          type: "slack",
          config: { routingKeyRef: "env://PAGERDUTY_ROUTING_KEY" },
        }),
      });
    const fcmSecretResolver = {
      check: vi.fn(),
      resolveValue: vi.fn(async () => ({
        available: true,
        scheme: "env",
        value: "raw-device-token",
      })),
    };
    const fcmDelivery = await new FcmMobilePushNotificationDeliverySender({
      baseUrl: "https://fcm.googleapis.com",
      fetchImpl,
      projectId: "romeo-prod",
      secretResolver: fcmSecretResolver,
      serviceAccountRef: "env://FCM_SERVICE_ACCOUNT_JSON",
      tokenUrl: "https://oauth2.googleapis.com/token",
    }).createDelivery({
      repository,
      notification,
      channel: channel({
        id: "channel_slack_fcm",
        type: "slack",
        config: { tokenRef: "env://FCM_DEVICE_TOKEN" },
      }),
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(smtpSendMail).not.toHaveBeenCalled();
    expect(pagerDutySecretResolver.resolveValue).not.toHaveBeenCalled();
    expect(fcmSecretResolver.resolveValue).not.toHaveBeenCalled();
    expect(slackDelivery).toMatchObject({
      status: "failed",
      attemptCount: 1,
      errorCode: "notification_channel_type_unsupported",
      metadata: {
        channelType: "webhook",
        provider: "slack",
        expectedChannelType: "slack",
      },
    });
    expect(webhookDelivery).toMatchObject({
      status: "failed",
      attemptCount: 1,
      errorCode: "notification_channel_type_unsupported",
      metadata: {
        channelType: "slack",
        provider: "webhook",
        expectedChannelType: "webhook",
      },
    });
    expect(emailDelivery).toMatchObject({
      status: "failed",
      attemptCount: 1,
      errorCode: "notification_channel_type_unsupported",
      metadata: {
        channelType: "slack",
        provider: "resend",
        expectedChannelType: "email",
      },
    });
    expect(smtpDelivery).toMatchObject({
      status: "failed",
      attemptCount: 1,
      errorCode: "notification_channel_type_unsupported",
      metadata: {
        channelType: "slack",
        provider: "smtp",
        expectedChannelType: "email",
      },
    });
    expect(teamsDelivery).toMatchObject({
      status: "failed",
      attemptCount: 1,
      errorCode: "notification_channel_type_unsupported",
      metadata: {
        channelType: "webhook",
        provider: "teams",
        expectedChannelType: "teams",
      },
    });
    expect(pagerDutyDelivery).toMatchObject({
      status: "failed",
      attemptCount: 1,
      errorCode: "notification_channel_type_unsupported",
      metadata: {
        channelType: "slack",
        provider: "pagerduty",
        expectedChannelType: "pagerduty",
      },
    });
    expect(fcmDelivery).toMatchObject({
      status: "failed",
      attemptCount: 1,
      errorCode: "notification_channel_type_unsupported",
      metadata: {
        channelType: "slack",
        provider: "fcm",
        expectedChannelType: "mobile_push",
      },
    });
  });

  it("sends Teams-compatible notifications with ID-only message cards", async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(null, { status: 202 }),
    );
    const repository = new InMemoryRomeoRepository();
    const sender = new TeamsWebhookNotificationDeliverySender({ fetchImpl });

    const delivery = await sender.createDelivery({
      repository,
      notification,
      channel: channel({
        id: "channel_teams",
        type: "teams",
        config: { url: "https://teams.example.com/webhook" },
      }),
    });

    const requestBody = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://teams.example.com/webhook",
      expect.objectContaining({ method: "POST" }),
    );
    expect(requestBody.summary).toContain("notification_test");
    expect(JSON.stringify(requestBody)).toContain("comment_test");
    expect(delivery).toMatchObject({
      status: "sent",
      attemptCount: 1,
      metadata: {
        notificationType: "chat_mention",
        channelType: "teams",
        provider: "teams",
        responseStatus: 202,
      },
    });
    expect(delivery.deliveredAt).toBeDefined();
  });

  it("sends PagerDuty events through a resolved routing key without retaining secrets", async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(null, { status: 202 }),
    );
    const secretResolver = {
      check: vi.fn(),
      resolveValue: vi.fn(async () => ({
        available: true,
        scheme: "env",
        value: "pagerduty-secret-routing-key",
      })),
    };
    const repository = new InMemoryRomeoRepository();
    const sender = new PagerDutyEventsNotificationDeliverySender({
      eventsUrl: "https://events.pagerduty.com/v2/enqueue",
      fetchImpl,
      secretResolver,
    });

    const delivery = await sender.createDelivery({
      repository,
      notification,
      channel: channel({
        id: "channel_pagerduty",
        type: "pagerduty",
        config: {
          routingKeyRef: "env://PAGERDUTY_ROUTING_KEY",
          severity: "warning",
        },
      }),
    });

    const requestBody = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(secretResolver.resolveValue).toHaveBeenCalledWith(
      "env://PAGERDUTY_ROUTING_KEY",
    );
    expect(requestBody.routing_key).toBe("pagerduty-secret-routing-key");
    expect(requestBody.payload.severity).toBe("warning");
    expect(requestBody.payload.custom_details.notificationId).toBe(
      "notification_test",
    );
    expect(delivery).toMatchObject({
      status: "sent",
      attemptCount: 1,
      metadata: {
        notificationType: "chat_mention",
        channelType: "pagerduty",
        provider: "pagerduty",
        responseStatus: 202,
      },
    });
    expect(JSON.stringify(delivery)).not.toContain(
      "pagerduty-secret-routing-key",
    );
    expect(JSON.stringify(delivery)).not.toContain("PAGERDUTY_ROUTING_KEY");
    expect(delivery.deliveredAt).toBeDefined();
  });

  it("fails PagerDuty delivery before egress when routing key resolution is unavailable", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }));
    const secretResolver = {
      check: vi.fn(),
      resolveValue: vi.fn(async () => ({
        available: false,
        failureCode: "secret_resolver_disabled",
        scheme: "env",
      })),
    };
    const repository = new InMemoryRomeoRepository();

    const delivery = await new PagerDutyEventsNotificationDeliverySender({
      eventsUrl: "https://events.pagerduty.com/v2/enqueue",
      fetchImpl,
      secretResolver,
    }).createDelivery({
      repository,
      notification,
      channel: channel({
        id: "channel_pagerduty_missing_secret",
        type: "pagerduty",
        config: { routingKeyRef: "env://PAGERDUTY_ROUTING_KEY" },
      }),
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(delivery).toMatchObject({
      status: "failed",
      attemptCount: 1,
      errorCode: "pagerduty_routing_key_unavailable",
      metadata: {
        provider: "pagerduty",
        secretRefScheme: "env",
        secretFailureCode: "secret_resolver_disabled",
      },
    });
    expect(delivery.metadata.nextAttemptAt).toBeUndefined();
    expect(JSON.stringify(delivery)).not.toContain("PAGERDUTY_ROUTING_KEY");
  });

  it("sends FCM mobile push notifications through managed secret refs without retaining tokens", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const serviceAccountJson = JSON.stringify({
      client_email: "firebase-adminsdk@example.iam.gserviceaccount.com",
      private_key: privateKey.export({ format: "pem", type: "pkcs8" }),
      project_id: "romeo-prod",
    });
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "https://oauth2.googleapis.com/token") {
          expect(String(init?.body)).toContain(
            "urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer",
          );
          return new Response(
            JSON.stringify({ access_token: "fcm-access-token", expires_in: 3600 }),
            { status: 200 },
          );
        }
        if (
          url ===
          "https://fcm.googleapis.com/v1/projects/romeo-prod/messages:send"
        ) {
          return new Response(JSON.stringify({ name: "projects/redacted" }), {
            status: 200,
          });
        }
        return new Response(null, { status: 404 });
      },
    );
    const secretResolver = {
      check: vi.fn(),
      resolveValue: vi.fn(async (secretRef: string) =>
        secretRef === "romeo-secret://secret_device_token"
          ? {
              available: true,
              scheme: "romeo-secret",
              value: JSON.stringify({ token: "fcm-secret-device-token" }),
            }
          : {
              available: true,
              scheme: "romeo-secret",
              value: serviceAccountJson,
            },
      ),
    };
    const repository = new InMemoryRomeoRepository();
    const sender = new FcmMobilePushNotificationDeliverySender({
      baseUrl: "https://fcm.googleapis.com",
      fetchImpl,
      projectId: "",
      secretResolver,
      serviceAccountRef: "romeo-secret://secret_fcm_service_account",
      tokenUrl: "https://oauth2.googleapis.com/token",
    });

    const delivery = await sender.createDelivery({
      repository,
      notification,
      channel: channel({
        id: "channel_mobile_push",
        type: "mobile_push",
        config: {
          tokenRef: "romeo-secret://secret_device_token",
          platform: "ios",
          collapseKey: "mention",
        },
      }),
    });

    expect(secretResolver.resolveValue).toHaveBeenCalledWith(
      "romeo-secret://secret_device_token",
    );
    expect(secretResolver.resolveValue).toHaveBeenCalledWith(
      "romeo-secret://secret_fcm_service_account",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const fcmBody = JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body));
    expect(fcmBody.message.token).toBe("fcm-secret-device-token");
    expect(fcmBody.message.notification.body).toBe(
      "You were mentioned in a chat.",
    );
    expect(fcmBody.message.data.notificationId).toBe("notification_test");
    expect(fcmBody.message.apns.headers["apns-collapse-id"]).toBe("mention");
    expect(fetchImpl.mock.calls[1]?.[1]?.headers).toMatchObject({
      authorization: "Bearer fcm-access-token",
    });
    expect(delivery).toMatchObject({
      status: "sent",
      attemptCount: 1,
      metadata: {
        notificationType: "chat_mention",
        channelType: "mobile_push",
        provider: "fcm",
        platform: "ios",
        responseStatus: 200,
      },
    });
    expect(JSON.stringify(delivery)).not.toContain("fcm-secret-device-token");
    expect(JSON.stringify(delivery)).not.toContain("fcm-access-token");
    expect(JSON.stringify(delivery)).not.toContain("secret_device_token");
    expect(JSON.stringify(delivery)).not.toContain("private_key");
    expect(delivery.deliveredAt).toBeDefined();
  });

  it("fails FCM mobile push before egress when the device token ref is unavailable", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const secretResolver = {
      check: vi.fn(),
      resolveValue: vi.fn(async () => ({
        available: false,
        failureCode: "secret_resolver_disabled",
        scheme: "romeo-secret",
      })),
    };
    const repository = new InMemoryRomeoRepository();

    const delivery = await new FcmMobilePushNotificationDeliverySender({
      baseUrl: "https://fcm.googleapis.com",
      fetchImpl,
      projectId: "romeo-prod",
      secretResolver,
      serviceAccountRef: "romeo-secret://secret_fcm_service_account",
      tokenUrl: "https://oauth2.googleapis.com/token",
    }).createDelivery({
      repository,
      notification,
      channel: channel({
        id: "channel_mobile_push_missing_secret",
        type: "mobile_push",
        config: { tokenRef: "romeo-secret://secret_device_token" },
      }),
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(delivery).toMatchObject({
      status: "failed",
      attemptCount: 1,
      errorCode: "mobile_push_token_unavailable",
      metadata: {
        provider: "fcm",
        secretRefScheme: "romeo-secret",
        secretFailureCode: "secret_resolver_disabled",
      },
    });
    expect(JSON.stringify(delivery)).not.toContain("secret_device_token");
  });

  it("sends SMTP email through an injected transport without retaining SMTP secrets or provider responses", async () => {
    const sendMail = vi.fn(async () => ({
      messageId: "smtp-secret-message-id",
      response: "250 queued",
    }));
    const repository = new InMemoryRomeoRepository();
    const sender = new SmtpEmailNotificationDeliverySender({
      from: "notify@romeo.example",
      host: "smtp.example.com",
      password: "smtp-secret-password",
      port: 587,
      secure: false,
      sendMail,
      timeoutMs: 2500,
      user: "smtp-user",
    });

    const delivery = await sender.createDelivery({
      repository,
      notification,
      channel: channel({
        id: "channel_smtp_email",
        type: "email",
        config: { to: "Target@Example.com" },
      }),
    });

    expect(sendMail).toHaveBeenCalledWith({
      from: "notify@romeo.example",
      to: "target@example.com",
      subject: "Romeo notification: chat_mention",
      text: expect.stringContaining("notification_test"),
    });
    expect(delivery).toMatchObject({
      status: "sent",
      attemptCount: 1,
      metadata: {
        notificationType: "chat_mention",
        channelType: "email",
        provider: "smtp",
      },
    });
    expect(JSON.stringify(delivery)).not.toContain("smtp-secret-password");
    expect(JSON.stringify(delivery)).not.toContain("smtp-secret-message-id");
    expect(JSON.stringify(delivery)).not.toContain("smtp-user");
    expect(JSON.stringify(delivery)).not.toContain("250 queued");
    expect(delivery.deliveredAt).toBeDefined();
  });

  it("retries transient webhook delivery failures without retaining failure metadata", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("temporary outage body", { status: 503 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const repository = new InMemoryRomeoRepository();
    const sender = new WebhookNotificationDeliverySender({
      fetchImpl,
      signingKey: "test-signing-key",
    });
    const notificationChannel = channel({
      id: "channel_webhook_retry",
      type: "webhook",
      config: { url: "https://example.com/hook" },
    });

    const failed = await sender.createDelivery({
      repository,
      notification,
      channel: notificationChannel,
    });
    const retried = await sender.retryDelivery({
      repository,
      notification,
      channel: notificationChannel,
      delivery: failed,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(failed).toMatchObject({
      status: "failed",
      attemptCount: 1,
      errorCode: "http_error",
      metadata: {
        channelType: "webhook",
        responseStatus: 503,
      },
    });
    expect(failed.metadata.nextAttemptAt).toEqual(expect.any(String));
    expect(JSON.stringify(failed)).not.toContain("temporary outage body");
    expect(retried).toMatchObject({
      status: "sent",
      attemptCount: 2,
      metadata: {
        channelType: "webhook",
        responseStatus: 204,
      },
    });
    expect(retried.errorCode).toBeUndefined();
    expect(retried.metadata.nextAttemptAt).toBeUndefined();
    expect(retried.deliveredAt).toBeDefined();
  });
});

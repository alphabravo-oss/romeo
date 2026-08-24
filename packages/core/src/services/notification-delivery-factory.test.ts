import { describe, expect, it, vi } from "vitest";

import type {
  NotificationDeliveryChannel,
  UserNotification,
} from "../domain/entities";
import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { testEnv } from "../test-support/env";
import {
  createNotificationDeliverySender,
  notificationWebhookNetworkOptionsFromEnv,
} from "./notification-delivery-factory";

const notification: UserNotification = {
  id: "notification_egress",
  orgId: "org_default",
  userId: "user_dev_admin",
  type: "chat_mention" as const,
  actorId: "service_account_commenter",
  resourceType: "chat",
  resourceId: "chat_welcome",
  metadata: {},
  createdAt: "2026-01-01T00:00:00.000Z",
};

const secretResolver = {
  check: vi.fn(async () => ({ available: true as const, scheme: "env" })),
  resolveValue: vi.fn(async () => ({
    available: true as const,
    scheme: "env",
    value: "pagerduty-routing-key",
  })),
};

function channel(
  type: NotificationDeliveryChannel["type"],
  config: Record<string, unknown>,
): NotificationDeliveryChannel {
  return {
    id: `channel_${type}`,
    orgId: "org_default",
    userId: "user_dev_admin",
    name: type,
    type,
    config,
    enabled: true,
    createdAt: notification.createdAt,
    updatedAt: notification.createdAt,
  };
}

describe("notification delivery factory egress policy", () => {
  it.each([
    ["webhook", "webhook", { url: "https://blocked.prod.invalid/hook" }],
    ["slack-webhook", "slack", { url: "https://blocked.prod.invalid/hook" }],
    ["teams-webhook", "teams", { url: "https://blocked.prod.invalid/hook" }],
    [
      "pagerduty-events",
      "pagerduty",
      { routingKeyRef: "env://PAGERDUTY_ROUTING_KEY" },
    ],
  ] as const)(
    "enforces the environment allowlist for %s deliveries",
    async (driver, channelType, config) => {
      const fetchImpl = vi.fn(async () => new Response(null, { status: 202 }));
      const env = testEnv({
        NOTIFICATION_DELIVERY_DRIVER: driver,
        NOTIFICATION_PAGERDUTY_EVENTS_URL:
          "https://blocked.prod.invalid/v2/enqueue",
        NOTIFICATION_WEBHOOK_ALLOWED_HOSTS: "allowed.prod.invalid",
        NOTIFICATION_WEBHOOK_EGRESS_POLICY: "require_allowlist",
      });
      const sender = createNotificationDeliverySender(env, {
        fetchImpl,
        secretResolver,
        signingKey: "notification-signing-key",
      });

      const delivery = await sender.createDelivery({
        repository: new InMemoryRomeoRepository(),
        notification,
        channel: channel(channelType, config),
      });

      expect(delivery).toMatchObject({
        errorCode: "network_error",
        status: "failed",
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it("normalizes the validated environment policy into factory options", () => {
    expect(
      notificationWebhookNetworkOptionsFromEnv(
        testEnv({
          NOTIFICATION_WEBHOOK_ALLOWED_HOSTS:
            "hooks.prod.invalid,*.notifications.prod.invalid",
          NOTIFICATION_WEBHOOK_EGRESS_POLICY: "require_allowlist",
        }),
      ),
    ).toEqual({
      allowedHosts: ["hooks.prod.invalid", "*.notifications.prod.invalid"],
      egressPolicy: "require_allowlist",
    });
  });
});

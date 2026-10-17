import { beforeEach, describe, expect, it, vi } from "vitest";

const dnsAnswer = vi.hoisted(() => ({
  records: [{ address: "10.0.0.5", family: 4 }],
}));
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => dnsAnswer.records),
}));

import {
  defaultNotificationPolicy,
  notificationChannelPolicyBlockReason,
} from "../domain/notification-policy";
import type {
  NotificationDeliveryChannel,
  UserNotification,
} from "../domain/entities";
import { ApiError } from "../errors";
import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { testEnv } from "../test-support/env";
import { hardenedWebhookFetch } from "./hardened-webhook-fetch";
import {
  createNotificationDeliverySender,
  createNotificationDestinationGuard,
} from "./notification-delivery-factory";

const now = "2026-01-01T00:00:00.000Z";
const notification: UserNotification = {
  id: "notification_egress",
  orgId: "org_default",
  userId: "user_dev_admin",
  type: "chat_mention",
  actorId: "service_account_commenter",
  resourceType: "chat",
  resourceId: "chat_welcome",
  metadata: { chatId: "chat_welcome", commentId: "comment_egress" },
  createdAt: now,
};

function channel(
  type: NotificationDeliveryChannel["type"],
  url: string,
): NotificationDeliveryChannel {
  return {
    id: `channel_${type}`,
    orgId: "org_default",
    userId: "user_dev_admin",
    name: type,
    type,
    config: { url },
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

const privateLookup = async () => [{ address: "10.0.0.5", family: 4 as const }];
const publicLookup = async () => [
  { address: "93.184.216.34", family: 4 as const },
];

describe("notification webhook egress", () => {
  beforeEach(() => {
    dnsAnswer.records = [{ address: "10.0.0.5", family: 4 }];
  });

  it("resolves DNS by default so a public-looking name cannot reach a private address", async () => {
    const pinnedFetchImpl = vi.fn(async () => new Response("unexpected"));
    await expect(
      hardenedWebhookFetch(
        "https://10-0-0-5.nip.io/hook",
        { method: "POST", body: "{}" },
        { pinnedFetchImpl },
      ),
    ).rejects.toMatchObject({ code: "connector_private_network_host_blocked" });
    expect(pinnedFetchImpl).not.toHaveBeenCalled();

    dnsAnswer.records = [{ address: "93.184.216.34", family: 4 }];
    const response = await hardenedWebhookFetch(
      "https://hooks.example.com/hook",
      { method: "POST", body: "{}" },
      { pinnedFetchImpl: vi.fn(async () => new Response("ok")) },
    );
    expect(await response.text()).toBe("ok");
  });

  it("denies private DNS answers and pins public ones for factory-built webhook senders", async () => {
    const env = testEnv({ NOTIFICATION_DELIVERY_DRIVER: "webhook" });
    const pinnedFetchImpl = vi.fn(
      async () => new Response(null, { status: 204 }),
    );
    const repository = new InMemoryRomeoRepository();
    const denied = await createNotificationDeliverySender(env, {
      hostLookup: privateLookup,
      pinnedFetchImpl,
      secretResolver: { check: vi.fn(), resolveValue: vi.fn() },
      signingKey: "notification-egress-signing-key",
    }).createDelivery({
      repository,
      notification,
      channel: channel("webhook", "https://10-0-0-5.nip.io/hook"),
    });
    expect(denied.status).toBe("failed");
    expect(pinnedFetchImpl).not.toHaveBeenCalled();

    const sent = await createNotificationDeliverySender(env, {
      hostLookup: publicLookup,
      pinnedFetchImpl,
      secretResolver: { check: vi.fn(), resolveValue: vi.fn() },
      signingKey: "notification-egress-signing-key",
    }).createDelivery({
      repository,
      notification,
      channel: channel("webhook", "https://hooks.example.com/hook"),
    });
    expect(sent.status).toBe("sent");
    expect(pinnedFetchImpl).toHaveBeenCalledWith(
      new URL("https://hooks.example.com/hook"),
      expect.objectContaining({ method: "POST", redirect: "manual" }),
      [{ address: "93.184.216.34", family: 4 }],
    );
  });

  it("refuses channels whose destination resolves privately at creation time", async () => {
    const env = testEnv();
    const deny = createNotificationDestinationGuard(env, {
      hostLookup: privateLookup,
    });
    const error = await deny("https://10-0-0-5.nip.io/hook").catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: "invalid_notification_channel",
      status: 400,
      details: { reason: "connector_private_network_host_blocked" },
    });

    await expect(
      createNotificationDestinationGuard(env, { hostLookup: publicLookup })(
        "https://hooks.example.com/hook",
      ),
    ).resolves.toBeUndefined();
  });

  it("limits Slack and Teams channels to their real webhook hosts unless the org allowlists others", () => {
    const policy = defaultNotificationPolicy();
    const reason = (type: "slack" | "teams", url: string) =>
      notificationChannelPolicyBlockReason({
        policy,
        channel: channel(type, url),
      });

    expect(reason("slack", "https://hooks.slack.com/services/T/B/C")).toBe(
      undefined,
    );
    expect(reason("slack", "https://hooks.slack-gov.com/services/T/B/C")).toBe(
      undefined,
    );
    expect(reason("slack", "https://10-0-0-5.nip.io/services/T/B/C")).toBe(
      "notification_destination_host_blocked_by_policy",
    );
    expect(
      reason("teams", "https://contoso.webhook.office.com/webhookb2/x"),
    ).toBe(undefined);
    expect(reason("teams", "https://outlook.office.com/webhook/x")).toBe(
      undefined,
    );
    expect(reason("teams", "https://webhook.office.com.evil.example/x")).toBe(
      "notification_destination_host_blocked_by_policy",
    );

    expect(
      notificationChannelPolicyBlockReason({
        policy: { ...policy, allowedSlackHosts: ["chat.example.com"] },
        channel: channel("slack", "https://chat.example.com/hooks/x"),
      }),
    ).toBe(undefined);
  });
});

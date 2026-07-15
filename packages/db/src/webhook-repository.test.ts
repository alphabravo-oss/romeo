import { describe, expect, it } from "vitest";

import {
  toWebhookDeliveryRecord,
  toWebhookSubscriptionRecord,
} from "./webhook-repository";

describe("webhook repository mappers", () => {
  it("filters unsupported subscription event types and maps lifecycle fields", () => {
    const subscription = toWebhookSubscriptionRecord({
      id: "webhook_1",
      orgId: "org_1",
      url: "https://example.com/webhooks",
      eventTypes: ["run.completed", "unknown", "quota.alert"],
      createdBy: "user_1",
      createdAt: new Date("2026-06-27T00:00:00.000Z"),
      updatedAt: new Date("2026-06-27T00:01:00.000Z"),
      disabledAt: new Date("2026-06-27T00:02:00.000Z"),
    });

    expect(subscription).toEqual({
      id: "webhook_1",
      orgId: "org_1",
      url: "https://example.com/webhooks",
      eventTypes: ["run.completed", "quota.alert"],
      createdBy: "user_1",
      createdAt: "2026-06-27T00:00:00.000Z",
      updatedAt: "2026-06-27T00:01:00.000Z",
      disabledAt: "2026-06-27T00:02:00.000Z",
    });
  });

  it("maps delivery retry state and defaults unknown event types to test events", () => {
    const delivery = toWebhookDeliveryRecord({
      id: "delivery_1",
      orgId: "org_1",
      subscriptionId: "webhook_1",
      eventType: "unknown",
      payload: [] as unknown as Record<string, unknown>,
      status: "failed",
      attemptCount: 2,
      responseStatus: 503,
      errorCode: "http_error",
      nextAttemptAt: new Date("2026-06-27T00:03:00.000Z"),
      createdAt: new Date("2026-06-27T00:00:00.000Z"),
      updatedAt: new Date("2026-06-27T00:01:00.000Z"),
    });

    expect(delivery).toMatchObject({
      id: "delivery_1",
      eventType: "webhook.test",
      payload: {},
      status: "failed",
      attemptCount: 2,
      responseStatus: 503,
      errorCode: "http_error",
      nextAttemptAt: "2026-06-27T00:03:00.000Z",
    });
  });
});

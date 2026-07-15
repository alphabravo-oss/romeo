import { describe, expect, it } from "vitest";

import {
  toNotificationDeliveryChannelRecord,
  toNotificationDeliveryRecord,
  toUserNotificationRecord,
} from "./notification-repository";

describe("notification repository mappers", () => {
  it("maps user notifications and defaults unknown values conservatively", () => {
    const notification = toUserNotificationRecord({
      id: "notification_1",
      orgId: "org_1",
      userId: "user_1",
      type: "unknown",
      actorId: "user_2",
      resourceType: "unknown",
      resourceId: "chat_1",
      metadata: [],
      readAt: null,
      createdAt: new Date("2026-06-27T00:00:00.000Z"),
    });

    expect(notification).toEqual({
      id: "notification_1",
      orgId: "org_1",
      userId: "user_1",
      type: "chat_mention",
      actorId: "user_2",
      resourceType: "chat",
      resourceId: "chat_1",
      metadata: {},
      createdAt: "2026-06-27T00:00:00.000Z",
    });
  });

  it("preserves support notification types and resource types", () => {
    const notification = toUserNotificationRecord({
      id: "notification_support_1",
      orgId: "org_1",
      userId: "user_1",
      type: "support_impersonation_session_revoked",
      actorId: "user_2",
      resourceType: "support_impersonation_session",
      resourceId: "session_1",
      metadata: { sessionId: "session_1" },
      readAt: null,
      createdAt: new Date("2026-06-27T00:00:00.000Z"),
    });

    expect(notification).toMatchObject({
      type: "support_impersonation_session_revoked",
      resourceType: "support_impersonation_session",
      resourceId: "session_1",
      metadata: { sessionId: "session_1" },
    });
  });

  it("maps delivery channels and deliveries with safe fallbacks", () => {
    const channel = toNotificationDeliveryChannelRecord({
      id: "channel_1",
      orgId: "org_1",
      userId: "user_1",
      type: "unknown",
      name: "Alerts",
      config: { url: "https://example.com/hook" },
      enabled: true,
      createdAt: new Date("2026-06-27T00:00:00.000Z"),
      updatedAt: new Date("2026-06-27T00:01:00.000Z"),
    });
    const delivery = toNotificationDeliveryRecord({
      id: "delivery_1",
      orgId: "org_1",
      userId: "user_1",
      notificationId: "notification_1",
      channelId: "channel_1",
      status: "unknown",
      attemptCount: 1,
      errorCode: "network_error",
      metadata: [],
      createdAt: new Date("2026-06-27T00:00:00.000Z"),
      updatedAt: new Date("2026-06-27T00:01:00.000Z"),
      deliveredAt: null,
    });

    expect(channel.type).toBe("webhook");
    expect(delivery).toMatchObject({
      status: "failed",
      metadata: {},
      errorCode: "network_error",
    });
    expect(delivery.deliveredAt).toBeUndefined();
  });
});

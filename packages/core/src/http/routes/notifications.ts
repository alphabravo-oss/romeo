import {
  createNotificationChannelRoute,
  getNotificationPolicyRoute,
  listNotificationChannelsRoute,
  listNotificationDeliveriesRoute,
  listNotificationsRoute,
  markNotificationReadRoute,
  retryDueNotificationDeliveriesRoute,
  updateNotificationPolicyRoute,
} from "@romeo/contracts";

import type { RomeoApi } from "../context";

export function registerNotificationRoutes(app: RomeoApi): void {
  app.openapi(listNotificationsRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").notifications.list(subject);
    return context.json({ data });
  });

  app.openapi(markNotificationReadRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .notifications.markRead(
        subject,
        context.req.valid("param").notificationId,
      );
    return context.json({ data });
  });

  app.openapi(listNotificationChannelsRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").notifications.channels(subject);
    return context.json({ data });
  });

  app.openapi(createNotificationChannelRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").notifications.createChannel({
      subject,
      type: body.type,
      name: body.name,
      config: body.config,
    });
    return context.json({ data }, 201);
  });

  app.openapi(listNotificationDeliveriesRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .notifications.deliveries(subject);
    return context.json({ data });
  });

  app.openapi(retryDueNotificationDeliveriesRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .notifications.retryDueDeliveries(subject);
    return context.json({ data }, 202);
  });

  app.openapi(getNotificationPolicyRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").notifications.policy(subject);
    return context.json({ data });
  });

  app.openapi(updateNotificationPolicyRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context
      .get("services")
      .notifications.updatePolicy({ subject, policy: body });
    return context.json({ data });
  });
}

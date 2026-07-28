import {
  bulkDisableWebhooksRoute,
  createWebhookRoute,
  disableWebhookRoute,
  listWebhookDeliveriesPageRoute,
  listWebhookDeliveriesRoute,
  listWebhooksRoute,
  retryDueWebhookDeliveriesRoute,
  testWebhookRoute,
} from "@romeo/contracts";

import type { RomeoApi } from "../context";

export function registerWebhookRoutes(app: RomeoApi): void {
  app.openapi(listWebhooksRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .webhooks.list(subject, context.req.valid("query").workspaceId);
    return context.json({ data });
  });

  app.openapi(bulkDisableWebhooksRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context
      .get("services")
      .webhooks.bulkDisable({ subject, webhookIds: body.webhookIds });
    return context.json({ data });
  });

  app.openapi(createWebhookRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context
      .get("services")
      .webhooks.create({ subject, url: body.url, eventTypes: body.eventTypes });
    return context.json({ data }, 201);
  });

  app.openapi(disableWebhookRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").webhooks.disable({
      subject,
      subscriptionId: context.req.valid("param").webhookId,
    });
    return context.json({ data });
  });

  app.openapi(listWebhookDeliveriesRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .webhooks.deliveries(subject, context.req.valid("param").webhookId);
    return context.json({ data });
  });

  app.openapi(testWebhookRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json") ?? {};
    const data = await context.get("services").webhooks.sendTest({
      subject,
      subscriptionId: context.req.valid("param").webhookId,
      ...(body.payload !== undefined ? { payload: body.payload } : {}),
    });
    return context.json({ data }, 202);
  });

  app.openapi(listWebhookDeliveriesPageRoute, async (context) => {
    const subject = context.get("subject");
    const query = context.req.valid("query");
    const page = await context
      .get("services")
      .webhooks.deliveriesPage(subject, {
        ...(query.webhookId !== undefined
          ? { subscriptionId: query.webhookId }
          : {}),
        limit: query.limit,
        ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
      });
    return context.json({ data: page.data, nextCursor: page.nextCursor });
  });

  app.openapi(retryDueWebhookDeliveriesRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .webhooks.retryDueDeliveries(subject);
    return context.json({ data }, 202);
  });
}

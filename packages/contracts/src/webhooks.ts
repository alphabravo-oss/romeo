import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";

const id = z.string().trim().min(1).max(300);
const time = z.iso.datetime();
export const WebhookEventTypeSchema = z
  .enum([
    "webhook.test",
    "run.cancelled",
    "run.completed",
    "run.failed",
    "tool.call.succeeded",
    "tool.call.failed",
    "knowledge.source.indexed",
    "quota.alert",
  ])
  .openapi("WebhookEventType");

export const WebhookSubscriptionSchema = z
  .strictObject({
    id,
    orgId: id,
    url: z.url(),
    eventTypes: z.array(WebhookEventTypeSchema),
    disabledAt: time.optional(),
    createdBy: id,
    createdAt: time,
    updatedAt: time,
  })
  .openapi("WebhookSubscription");
export const WebhookDeliverySchema = z
  .strictObject({
    id,
    orgId: id,
    subscriptionId: id,
    eventType: WebhookEventTypeSchema,
    payload: z.record(z.string(), z.unknown()),
    status: z.enum(["delivered", "failed", "pending"]),
    attemptCount: z.number().int().min(0),
    responseStatus: z.number().int().min(100).max(599).optional(),
    errorCode: z.string().optional(),
    nextAttemptAt: time.optional(),
    createdAt: time,
    updatedAt: time,
  })
  .openapi("WebhookDelivery");
export const CreateWebhookSubscriptionSchema = z
  .strictObject({
    url: z.url(),
    eventTypes: z.array(WebhookEventTypeSchema).min(1).max(25),
  })
  .openapi("CreateWebhookSubscriptionRequest");
export const TestWebhookSchema = z
  .strictObject({ payload: z.record(z.string(), z.unknown()).optional() })
  .openapi("TestWebhookRequest");
export const BulkDisableWebhooksSchema = z
  .strictObject({ webhookIds: z.array(id).min(1).max(100) })
  .openapi("BulkDisableWebhooksRequest");
export const WebhookBulkDisableResultSchema = z
  .strictObject({
    webhookId: id,
    status: z.enum(["disabled", "already_disabled", "not_found"]),
  })
  .openapi("WebhookBulkDisableResult");
const CreatedWebhookSubscriptionSchema = z
  .strictObject({
    subscription: WebhookSubscriptionSchema,
    signingSecret: z.string().min(1),
  })
  .openapi("CreatedWebhookSubscription");
const BackgroundJobSchema = z.strictObject({
  id,
  orgId: id,
  workspaceId: id.optional(),
  type: z.string(),
  status: z.enum(["queued", "running", "completed", "failed"]),
  payload: z.record(z.string(), z.unknown()),
  createdAt: time,
  updatedAt: time,
  completedAt: time.optional(),
});
const WebhookRetryResultSchema = z
  .strictObject({
    job: BackgroundJobSchema,
    deliveries: z.array(WebhookDeliverySchema),
  })
  .openapi("WebhookRetryResult");

const workspaceQuery = z.strictObject({ workspaceId: id.optional() });
const deliveryPageQuery = z.strictObject({
  webhookId: id.optional(),
  limit: z.coerce.number().int().min(1).max(1_000).default(50),
  cursor: z.string().min(1).max(1_000).optional(),
});
const webhookPath = z.strictObject({ webhookId: id });
const meta = { tags: ["Webhooks"], security: authenticationSecurity };
const errors = standardErrorResponses;
const body = <T extends z.ZodType>(schema: T, required = true) => ({
  required,
  content: { "application/json": { schema } },
});

export const listWebhooksRoute = createRoute({
  ...meta,
  method: "get",
  path: "/api/v1/webhooks",
  operationId: "webhooks.list",
  summary: "List",
  request: { query: workspaceQuery },
  responses: {
    200: jsonResponse(
      "Webhook subscriptions",
      dataEnvelope(z.array(WebhookSubscriptionSchema)),
    ),
    ...errors,
  },
});
export const createWebhookRoute = createRoute({
  ...meta,
  method: "post",
  path: "/api/v1/webhooks",
  operationId: "webhooks.create",
  summary: "Create",
  request: { body: body(CreateWebhookSubscriptionSchema) },
  responses: {
    201: jsonResponse(
      "Webhook subscription with one-time signing secret",
      dataEnvelope(CreatedWebhookSubscriptionSchema),
    ),
    ...errors,
  },
});
export const bulkDisableWebhooksRoute = createRoute({
  ...meta,
  method: "post",
  path: "/api/v1/webhooks/bulk-disable",
  operationId: "webhooks.bulkDisable",
  summary: "Bulk disable",
  request: { body: body(BulkDisableWebhooksSchema) },
  responses: {
    200: jsonResponse(
      "Webhook bulk-disable results",
      dataEnvelope(z.array(WebhookBulkDisableResultSchema)),
    ),
    ...errors,
  },
});
export const disableWebhookRoute = createRoute({
  ...meta,
  method: "post",
  path: "/api/v1/webhooks/{webhookId}/disable",
  operationId: "webhooks.disable",
  summary: "Disable",
  request: { params: webhookPath },
  responses: {
    200: jsonResponse(
      "Disabled webhook subscription",
      dataEnvelope(WebhookSubscriptionSchema),
    ),
    ...errors,
  },
});
export const listWebhookDeliveriesRoute = createRoute({
  ...meta,
  method: "get",
  path: "/api/v1/webhooks/{webhookId}/deliveries",
  operationId: "webhooks.listDeliveries",
  summary: "List deliveries",
  request: { params: webhookPath },
  responses: {
    200: jsonResponse(
      "Webhook deliveries",
      dataEnvelope(z.array(WebhookDeliverySchema)),
    ),
    ...errors,
  },
});
export const testWebhookRoute = createRoute({
  ...meta,
  method: "post",
  path: "/api/v1/webhooks/{webhookId}/test",
  operationId: "webhooks.test",
  summary: "Test",
  request: { params: webhookPath, body: body(TestWebhookSchema, false) },
  responses: {
    202: jsonResponse(
      "Webhook test delivery",
      dataEnvelope(WebhookDeliverySchema),
    ),
    ...errors,
  },
});
export const listWebhookDeliveriesPageRoute = createRoute({
  ...meta,
  method: "get",
  path: "/api/v1/webhook-deliveries",
  operationId: "webhooks.listDeliveriesPage",
  summary: "List deliveries page",
  request: { query: deliveryPageQuery },
  responses: {
    200: jsonResponse(
      "Webhook delivery page",
      z.strictObject({
        data: z.array(WebhookDeliverySchema),
        nextCursor: z.string().optional(),
      }),
    ),
    ...errors,
  },
});
export const retryDueWebhookDeliveriesRoute = createRoute({
  ...meta,
  method: "post",
  path: "/api/v1/webhook-deliveries/retry-due",
  operationId: "webhooks.retryDueDeliveries",
  summary: "Retry due deliveries",
  responses: {
    202: jsonResponse(
      "Webhook retry job result",
      dataEnvelope(WebhookRetryResultSchema),
    ),
    ...errors,
  },
});

export const webhookRoutes = [
  listWebhooksRoute,
  createWebhookRoute,
  bulkDisableWebhooksRoute,
  disableWebhookRoute,
  listWebhookDeliveriesRoute,
  testWebhookRoute,
  listWebhookDeliveriesPageRoute,
  retryDueWebhookDeliveriesRoute,
] as const;

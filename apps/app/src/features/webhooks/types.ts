export type {
  BulkDisableWebhooksRequest,
  CreatedWebhookSubscription,
  CreateWebhookSubscriptionRequest,
  TestWebhookRequest,
  WebhookBulkDisableResult,
  WebhookDelivery,
  WebhookEventType,
  WebhookRetryResult,
  WebhookSubscription,
} from "@romeo/api-client/generated/sdk";
import type { WebhookEventType } from "@romeo/api-client/generated/sdk";
import { zWebhookEventType } from "@romeo/api-client/generated/sdk/zod";

export const webhookEventTypes =
  zWebhookEventType.options satisfies readonly WebhookEventType[];

export type WebhookDeliveryStatus =
  import("@romeo/api-client/generated/sdk").WebhookDelivery["status"];
export type WebhookBulkDisableStatus =
  import("@romeo/api-client/generated/sdk").WebhookBulkDisableResult["status"];
export type CreateWebhookInput =
  import("@romeo/api-client/generated/sdk").CreateWebhookSubscriptionRequest;
export interface WebhookDeliveryPage {
  data: import("@romeo/api-client/generated/sdk").WebhookDelivery[];
  nextCursor?: string;
}

import {
  webhooksBulkDisable,
  webhooksCreate,
  webhooksDisable,
  webhooksRetryDueDeliveries,
  webhooksTest,
  type CreateWebhookSubscriptionRequest,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export async function bulkDisableWebhooks(webhookIds: string[]) {
  configureBrowserApiClients();
  const response = await webhooksBulkDisable({
    body: { webhookIds },
    throwOnError: true,
  });
  return response.data.data;
}

export async function createWebhook(input: CreateWebhookSubscriptionRequest) {
  configureBrowserApiClients();
  const response = await webhooksCreate({ body: input, throwOnError: true });
  return response.data.data;
}

export async function disableWebhook(webhookId: string) {
  configureBrowserApiClients();
  const response = await webhooksDisable({
    path: { webhookId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function testWebhook(webhookId: string) {
  configureBrowserApiClients();
  const response = await webhooksTest({
    path: { webhookId },
    body: {},
    throwOnError: true,
  });
  return response.data.data;
}

export async function retryDueWebhookDeliveries() {
  configureBrowserApiClients();
  const response = await webhooksRetryDueDeliveries({ throwOnError: true });
  return response.data.data;
}

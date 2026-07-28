import {
  webhooksList,
  webhooksListDeliveries,
  webhooksListDeliveriesPage,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export async function listWebhooks(workspaceId?: string) {
  configureBrowserApiClients();
  const response = await webhooksList({
    query: workspaceId === undefined ? {} : { workspaceId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function listWebhookDeliveries(webhookId: string) {
  configureBrowserApiClients();
  const response = await webhooksListDeliveries({
    path: { webhookId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function listWebhookDeliveriesPage(
  options: { webhookId?: string; limit?: number; cursor?: string } = {},
) {
  configureBrowserApiClients();
  const response = await webhooksListDeliveriesPage({
    query: options,
    throwOnError: true,
  });
  return response.data;
}

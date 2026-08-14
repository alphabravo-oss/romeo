import * as appQueryKeys from "../../lib/app-query-keys";
import {
  invalidateCachedResourceExactly,
  serverMutationOptions,
} from "../../lib/server-mutation-options";
import {
  bulkDisableWebhooks,
  createWebhook,
  disableWebhook,
  testWebhook,
} from "./mutations";
import type { WebhookSubscription } from "./types";

type WebhookListSnapshot = WebhookSubscription[] | undefined;

export function createWebhookMutationOptions(workspaceId?: string) {
  return serverMutationOptions({
    resource: "webhook.create",
    mutationFn: createWebhook,
    // The response includes a one-time signing secret. Never reconcile it into
    // query state; refresh only the non-secret subscription inventory.
    invalidations: () => [
      { exact: true, queryKey: appQueryKeys.webhooks(workspaceId) },
    ],
  });
}

export function disableWebhookMutationOptions(workspaceId?: string) {
  const queryKey = appQueryKeys.webhooks(workspaceId);
  return serverMutationOptions<
    Awaited<ReturnType<typeof disableWebhook>>,
    Error,
    string,
    WebhookListSnapshot
  >({
    resource: "webhook.disable",
    mutationFn: disableWebhook,
    optimistic: webhookDisableOptimisticPolicy(queryKey, (id) => [id]),
    reconcile: (client, subscription) => {
      client.setQueryData<WebhookSubscription[]>(queryKey, (current) =>
        current?.map((entry) =>
          entry.id === subscription.id ? subscription : entry,
        ),
      );
    },
    invalidations: () => [{ exact: true, queryKey }],
  });
}

export function bulkDisableWebhooksMutationOptions(workspaceId?: string) {
  const queryKey = appQueryKeys.webhooks(workspaceId);
  return serverMutationOptions<
    Awaited<ReturnType<typeof bulkDisableWebhooks>>,
    Error,
    string[],
    WebhookListSnapshot
  >({
    resource: "webhook.bulkDisable",
    mutationFn: bulkDisableWebhooks,
    optimistic: webhookDisableOptimisticPolicy(queryKey, (ids) => ids),
    reconcile: (client, results) => {
      const byId = new Map(results.map((result) => [result.webhookId, result]));
      client.setQueryData<WebhookSubscription[]>(queryKey, (current) =>
        current
          ?.filter((entry) => byId.get(entry.id)?.status !== "not_found")
          .map((entry) =>
            byId.has(entry.id) && entry.disabledAt === undefined
              ? { ...entry, disabledAt: new Date().toISOString() }
              : entry,
          ),
      );
    },
    invalidations: () => [{ exact: true, queryKey }],
  });
}

export function testWebhookMutationOptions() {
  return serverMutationOptions({
    resource: "webhook.test",
    mutationFn: testWebhook,
    reconcile: (client, _delivery, webhookId) =>
      invalidateCachedResourceExactly(
        client,
        appQueryKeys.webhookDeliveries(webhookId),
      ),
  });
}

function webhookDisableOptimisticPolicy<TVariables>(
  queryKey: ReturnType<typeof appQueryKeys.webhooks>,
  getIds: (variables: TVariables) => string[],
) {
  return {
    snapshot: async (
      client: Parameters<typeof invalidateCachedResourceExactly>[0],
    ) => {
      await client.cancelQueries({ exact: true, queryKey });
      return client.getQueryData<WebhookSubscription[]>(queryKey);
    },
    update: (
      client: Parameters<typeof invalidateCachedResourceExactly>[0],
      variables: TVariables,
    ) => {
      const ids = new Set(getIds(variables));
      const disabledAt = new Date().toISOString();
      client.setQueryData<WebhookSubscription[]>(queryKey, (current) =>
        current?.map((entry) =>
          ids.has(entry.id) ? { ...entry, disabledAt } : entry,
        ),
      );
    },
    rollback: (
      client: Parameters<typeof invalidateCachedResourceExactly>[0],
      snapshot: WebhookListSnapshot,
    ) => {
      if (snapshot === undefined)
        client.removeQueries({ exact: true, queryKey });
      else client.setQueryData(queryKey, snapshot);
    },
  };
}

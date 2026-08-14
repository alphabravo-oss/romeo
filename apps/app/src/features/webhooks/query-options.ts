import { keepPreviousData, queryOptions } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import {
  abortableQuery,
  serverQueryPolicy,
} from "../../lib/server-query-options";
import { listWebhookDeliveriesPage, listWebhooks } from "./queries";

export function webhooksQueryOptions(workspaceId?: string) {
  return queryOptions({
    ...serverQueryPolicy("interactive", "webhooks", { workspaceId }),
    queryKey: appQueryKeys.webhooks(workspaceId),
    queryFn: ({ signal }) =>
      abortableQuery(signal, () => listWebhooks(workspaceId)),
  });
}

export function webhookDeliveriesQueryOptions(input: {
  cursor: string | undefined;
  pageSize: number;
  webhookId: string | undefined;
}) {
  const { cursor, pageSize, webhookId } = input;
  return queryOptions({
    ...serverQueryPolicy("volatile", "webhookDeliveries", input),
    queryKey: appQueryKeys.webhookDeliveries(webhookId, {
      cursor,
      pageSize,
    }),
    queryFn: ({ signal }) =>
      abortableQuery(signal, () =>
        listWebhookDeliveriesPage({
          webhookId: webhookId!,
          limit: pageSize,
          ...(cursor === undefined ? {} : { cursor }),
        }),
      ),
    enabled: webhookId !== undefined,
    placeholderData: keepPreviousData,
  });
}

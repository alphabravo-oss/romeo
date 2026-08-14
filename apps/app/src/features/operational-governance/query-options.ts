import { queryOptions } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import {
  abortableQuery,
  serverQueryPolicy,
} from "../../lib/server-query-options";
import {
  getQuotasDistributedStatus,
  getUsageSummary,
  listQuotas,
  listUsageAlerts,
  listUsageEvents,
} from "./queries";

function volatileOptions<T>(
  resource: string,
  queryKey: readonly unknown[],
  queryFn: () => Promise<T>,
) {
  return queryOptions({
    ...serverQueryPolicy("volatile", resource),
    queryKey,
    queryFn: ({ signal }) => abortableQuery(signal, queryFn),
  });
}

export const quotasQueryOptions = () =>
  volatileOptions("quotas", appQueryKeys.quotas(), listQuotas);
export const quotasDistributedStatusQueryOptions = () =>
  volatileOptions(
    "quotasDistributedStatus",
    appQueryKeys.quotasDistributedStatus(),
    getQuotasDistributedStatus,
  );
export const usageSummaryQueryOptions = () =>
  volatileOptions("usageSummary", appQueryKeys.usageSummary(), getUsageSummary);
export const usageAlertsQueryOptions = () =>
  volatileOptions("usageAlerts", appQueryKeys.usageAlerts(), listUsageAlerts);
export function usageEventsQueryOptions(range: string) {
  return queryOptions({
    ...serverQueryPolicy("volatile", "usageEvents", { range }),
    queryKey: appQueryKeys.usageEvents(range),
    queryFn: ({ signal }) => abortableQuery(signal, listUsageEvents),
  });
}

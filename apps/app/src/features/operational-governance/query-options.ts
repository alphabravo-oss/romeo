import { queryOptions } from "@tanstack/react-query";
import type { UsageInterval } from "@romeo/contracts";

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
export const usageSummaryQueryOptions = (interval?: UsageInterval) =>
  volatileOptions("usageSummary", appQueryKeys.usageSummary(interval), () =>
    getUsageSummary(interval),
  );
export const usageAlertsQueryOptions = () =>
  volatileOptions("usageAlerts", appQueryKeys.usageAlerts(), listUsageAlerts);
export function usageEventsQueryOptions(interval?: UsageInterval) {
  return queryOptions({
    ...serverQueryPolicy("volatile", "usageEvents", { interval }),
    queryKey: appQueryKeys.usageEvents(interval),
    queryFn: ({ signal }) =>
      abortableQuery(signal, () => listUsageEvents(interval)),
  });
}

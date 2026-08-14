import { queryOptions } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import {
  abortableQuery,
  serverQueryPolicy,
} from "../../lib/server-query-options";
import { getAbuseControls, getAdminAnalyticsSummary } from "./queries";

export function abuseControlsQueryOptions() {
  return queryOptions({
    ...serverQueryPolicy("stable", "abuseControls"),
    queryKey: appQueryKeys.abuseControls(),
    queryFn: ({ signal }) => abortableQuery(signal, getAbuseControls),
  });
}

export function adminAnalyticsSummaryQueryOptions(
  range: string,
  window: Parameters<typeof getAdminAnalyticsSummary>[0],
) {
  return queryOptions({
    ...serverQueryPolicy("volatile", "adminAnalyticsSummary", { range }),
    queryKey: appQueryKeys.adminAnalyticsSummary(range),
    queryFn: ({ signal }) =>
      abortableQuery(signal, () => getAdminAnalyticsSummary(window)),
    refetchInterval: 30_000,
  });
}

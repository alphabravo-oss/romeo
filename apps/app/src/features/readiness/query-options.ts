import { queryOptions } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import {
  abortableQuery,
  serverQueryPolicy,
} from "../../lib/server-query-options";
import { getReadinessReport } from "./queries";

export function readinessQueryOptions() {
  return queryOptions({
    ...serverQueryPolicy("volatile", "readiness"),
    queryKey: appQueryKeys.readiness(),
    queryFn: ({ signal }) => abortableQuery(signal, getReadinessReport),
  });
}

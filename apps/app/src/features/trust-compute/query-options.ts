import { queryOptions } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import {
  abortableQuery,
  serverQueryPolicy,
} from "../../lib/server-query-options";
import { getTrustPosture } from "./queries";

export function trustPostureQueryOptions() {
  return queryOptions({
    ...serverQueryPolicy("volatile", "trustPosture"),
    queryKey: appQueryKeys.trustPosture(),
    queryFn: ({ signal }) => abortableQuery(signal, getTrustPosture),
  });
}

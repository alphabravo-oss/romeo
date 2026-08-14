import { queryOptions } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import {
  abortableQuery,
  serverQueryPolicy,
} from "../../lib/server-query-options";
import { getEdgeSecurityPosture } from "./queries";

export function edgeSecurityPostureQueryOptions() {
  return queryOptions({
    ...serverQueryPolicy("volatile", "edgeSecurityPosture"),
    queryKey: appQueryKeys.edgeSecurityPosture(),
    queryFn: ({ signal }) => abortableQuery(signal, getEdgeSecurityPosture),
  });
}

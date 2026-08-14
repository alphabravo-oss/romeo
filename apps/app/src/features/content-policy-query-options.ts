import { queryOptions } from "@tanstack/react-query";

import * as appQueryKeys from "../lib/app-query-keys";
import { abortableQuery, serverQueryPolicy } from "../lib/server-query-options";
import { getContentPolicy } from "./content-policy";

export function contentPolicyQueryOptions() {
  return queryOptions({
    ...serverQueryPolicy("stable", "contentPolicy"),
    queryKey: appQueryKeys.contentPolicy(),
    queryFn: ({ signal }) => abortableQuery(signal, getContentPolicy),
  });
}

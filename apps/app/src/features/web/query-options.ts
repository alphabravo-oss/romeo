import { queryOptions } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import {
  abortableQuery,
  serverQueryPolicy,
} from "../../lib/server-query-options";
import { getWebSearchConfiguration } from "./queries";

export function webSearchConfigurationQueryOptions() {
  return queryOptions({
    ...serverQueryPolicy("stable", "webSearchConfiguration"),
    queryKey: appQueryKeys.webSearchConfiguration(),
    queryFn: ({ signal }) => abortableQuery(signal, getWebSearchConfiguration),
  });
}

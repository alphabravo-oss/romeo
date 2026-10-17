import { queryOptions } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import {
  abortableQuery,
  serverQueryPolicy,
} from "../../lib/server-query-options";
import { getPostgresOperationalPosture } from "./queries";

export function postgresOperationalPostureQueryOptions() {
  return queryOptions({
    ...serverQueryPolicy("volatile", "postgresOperationalPosture"),
    queryKey: appQueryKeys.postgresOperationalPosture(),
    queryFn: ({ signal }) =>
      abortableQuery(signal, getPostgresOperationalPosture),
  });
}

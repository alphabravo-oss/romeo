import { queryOptions } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import {
  abortableQuery,
  serverQueryPolicy,
} from "../../lib/server-query-options";
import { listToolConnectors, listToolOperations } from "./queries";

export function toolConnectorsQueryOptions() {
  return queryOptions({
    ...serverQueryPolicy("interactive", "toolConnectors"),
    queryKey: appQueryKeys.toolConnectors(),
    queryFn: ({ signal }) => abortableQuery(signal, listToolConnectors),
  });
}

export function toolOperationsQueryOptions(connectorId: string) {
  return queryOptions({
    ...serverQueryPolicy("interactive", "toolOperations", { connectorId }),
    queryKey: appQueryKeys.toolOperations(connectorId),
    queryFn: ({ signal }) =>
      abortableQuery(signal, () => listToolOperations(connectorId)),
  });
}

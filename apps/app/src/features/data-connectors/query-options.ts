import { queryOptions } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import {
  abortableQuery,
  serverQueryPolicy,
} from "../../lib/server-query-options";
import {
  getDataConnectorCatalog,
  listDataConnectors,
  listDataConnectorSyncs,
} from "./queries";

export function dataConnectorsQueryOptions(workspaceId?: string) {
  return queryOptions({
    ...serverQueryPolicy("interactive", "dataConnectors", { workspaceId }),
    queryKey: appQueryKeys.dataConnectors(workspaceId),
    queryFn: ({ signal }) =>
      abortableQuery(signal, () => listDataConnectors(workspaceId!)),
    enabled: workspaceId !== undefined,
  });
}

export function dataConnectorCatalogQueryOptions() {
  return queryOptions({
    ...serverQueryPolicy("stable", "dataConnectorCatalog"),
    queryKey: appQueryKeys.dataConnectorCatalog(),
    queryFn: ({ signal }) => abortableQuery(signal, getDataConnectorCatalog),
  });
}

export function dataConnectorSyncsQueryOptions(connectorId?: string) {
  return queryOptions({
    ...serverQueryPolicy("volatile", "dataConnectorSyncs", { connectorId }),
    queryKey: appQueryKeys.dataConnectorSyncs(connectorId),
    queryFn: ({ signal }) =>
      abortableQuery(signal, () => listDataConnectorSyncs(connectorId!)),
    enabled: connectorId !== undefined,
  });
}

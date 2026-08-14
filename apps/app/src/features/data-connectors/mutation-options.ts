import * as appQueryKeys from "../../lib/app-query-keys";
import {
  invalidateCachedResourceExactly,
  serverMutationOptions,
} from "../../lib/server-mutation-options";
import { createDataConnector, syncLocalDataConnector } from "./mutations";
import type { DataConnector, DataConnectorSync } from "./types";

export function createDataConnectorMutationOptions() {
  return serverMutationOptions({
    resource: "dataConnector.create",
    mutationFn: createDataConnector,
    reconcile: async (client, connector: DataConnector) => {
      client.setQueryData<DataConnector[]>(
        appQueryKeys.dataConnectors(connector.workspaceId),
        (current) =>
          current === undefined ? current : upsertById(current, connector),
      );
      await Promise.all([
        invalidateCachedResourceExactly(client, appQueryKeys.auditLogs()),
        invalidateCachedResourceExactly(client, appQueryKeys.tablePages()),
      ]);
    },
    invalidations: (connector) => [
      {
        exact: true,
        queryKey: appQueryKeys.dataConnectors(connector.workspaceId),
      },
    ],
  });
}

export function syncLocalDataConnectorMutationOptions() {
  return serverMutationOptions({
    ephemeral: true,
    resource: "dataConnector.localImport.sync",
    mutationFn: syncLocalDataConnector,
    reconcile: async (client, sync: DataConnectorSync) => {
      client.setQueryData<DataConnectorSync[]>(
        appQueryKeys.dataConnectorSyncs(sync.connectorId),
        (current) =>
          current === undefined ? current : upsertById(current, sync),
      );
      await Promise.all([
        invalidateCachedResourceExactly(client, appQueryKeys.usageEvents()),
        invalidateCachedResourceExactly(client, appQueryKeys.usageSummary()),
        invalidateCachedResourceExactly(client, appQueryKeys.usageAlerts()),
        invalidateCachedResourceExactly(client, appQueryKeys.auditLogs()),
      ]);
    },
    invalidations: (sync) => [
      {
        exact: true,
        queryKey: appQueryKeys.dataConnectorSyncs(sync.connectorId),
      },
      {
        exact: true,
        queryKey: appQueryKeys.knowledgeSources(sync.knowledgeBaseId),
      },
      {
        exact: true,
        queryKey: appQueryKeys.dataConnectors(sync.workspaceId),
      },
    ],
  });
}

function upsertById<T extends { id: string }>(current: T[], next: T): T[] {
  return current.some((item) => item.id === next.id)
    ? current.map((item) => (item.id === next.id ? next : item))
    : [next, ...current];
}

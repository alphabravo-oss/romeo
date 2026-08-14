import * as appQueryKeys from "../../lib/app-query-keys";
import {
  invalidateCachedResourceExactly,
  serverMutationOptions,
} from "../../lib/server-mutation-options";
import { refreshToolActivityQueries } from "../tools/cache-policy";
import {
  checkToolConnectorAuth,
  dispatchToolOperation,
  importOpenApiTool,
  testToolOperation,
  updateToolConnector,
  updateToolOperation,
} from "./mutations";
import type { ToolConnector, ToolOperation } from "./types";

type ConnectorSnapshot = ToolConnector[] | undefined;
type OperationSnapshot = ToolOperation[] | undefined;

export function importOpenApiToolMutationOptions() {
  return serverMutationOptions({
    resource: "toolConnector.openapi.import",
    mutationFn: importOpenApiTool,
    reconcile: async (client, imported) => {
      client.setQueryData<ToolConnector[]>(
        appQueryKeys.toolConnectors(),
        (current) =>
          current === undefined
            ? current
            : upsertById(current, imported.connector),
      );
      client.setQueryData(
        appQueryKeys.toolOperations(imported.connector.id),
        imported.operations,
      );
      await refreshToolConnectorAudit(client);
    },
    invalidations: (imported) => [
      { exact: true, queryKey: appQueryKeys.toolConnectors() },
      {
        exact: true,
        queryKey: appQueryKeys.toolOperations(imported.connector.id),
      },
    ],
  });
}

export function updateToolConnectorMutationOptions() {
  return serverMutationOptions<
    ToolConnector,
    Error,
    Parameters<typeof updateToolConnector>[0],
    ConnectorSnapshot
  >({
    resource: "toolConnector.update",
    mutationFn: updateToolConnector,
    optimistic: {
      snapshot: async (client) => {
        const queryKey = appQueryKeys.toolConnectors();
        await client.cancelQueries({ exact: true, queryKey });
        return client.getQueryData<ToolConnector[]>(queryKey);
      },
      update: (client, variables) => {
        client.setQueryData<ToolConnector[]>(
          appQueryKeys.toolConnectors(),
          (current) =>
            current?.map((connector) =>
              connector.id === variables.connectorId
                ? { ...connector, enabled: variables.enabled }
                : connector,
            ),
        );
      },
      rollback: (client, snapshot) => {
        restoreQuery(client, appQueryKeys.toolConnectors(), snapshot);
      },
    },
    reconcile: async (client, connector) => {
      client.setQueryData<ToolConnector[]>(
        appQueryKeys.toolConnectors(),
        (current) =>
          current?.map((item) => (item.id === connector.id ? connector : item)),
      );
      await refreshToolConnectorAudit(client);
    },
    invalidations: () => [
      { exact: true, queryKey: appQueryKeys.toolConnectors() },
    ],
  });
}

export function checkToolConnectorAuthMutationOptions() {
  return serverMutationOptions({
    resource: "toolConnector.auth.check",
    mutationFn: checkToolConnectorAuth,
  });
}

export function updateToolOperationMutationOptions() {
  return serverMutationOptions<
    ToolOperation,
    Error,
    Parameters<typeof updateToolOperation>[0],
    OperationSnapshot
  >({
    resource: "toolConnector.operation.update",
    mutationFn: updateToolOperation,
    optimistic: {
      snapshot: async (client, variables) => {
        const queryKey = appQueryKeys.toolOperations(variables.connectorId);
        await client.cancelQueries({ exact: true, queryKey });
        return client.getQueryData<ToolOperation[]>(queryKey);
      },
      update: (client, variables) => {
        client.setQueryData<ToolOperation[]>(
          appQueryKeys.toolOperations(variables.connectorId),
          (current) =>
            current?.map((operation) =>
              operation.operationId === variables.operationId
                ? { ...operation, enabled: variables.enabled }
                : operation,
            ),
        );
      },
      rollback: (client, snapshot, variables) => {
        restoreQuery(
          client,
          appQueryKeys.toolOperations(variables.connectorId),
          snapshot,
        );
      },
    },
    reconcile: async (client, operation, variables) => {
      client.setQueryData<ToolOperation[]>(
        appQueryKeys.toolOperations(variables.connectorId),
        (current) =>
          current?.map((item) =>
            item.operationId === operation.operationId ? operation : item,
          ),
      );
      await refreshToolConnectorAudit(client);
    },
    invalidations: (_operation, variables) => [
      {
        exact: true,
        queryKey: appQueryKeys.toolOperations(variables.connectorId),
      },
    ],
  });
}

export function testToolOperationMutationOptions() {
  return serverMutationOptions({
    resource: "toolConnector.operation.test",
    mutationFn: testToolOperation,
  });
}

export function dispatchToolOperationMutationOptions() {
  return serverMutationOptions({
    resource: "toolConnector.operation.dispatch",
    mutationFn: dispatchToolOperation,
    reconcile: (client) => refreshToolActivityQueries(client),
  });
}

function upsertById<T extends { id: string }>(current: T[], next: T): T[] {
  return current.some((item) => item.id === next.id)
    ? current.map((item) => (item.id === next.id ? next : item))
    : [...current, next];
}

function restoreQuery<T>(
  client: Parameters<typeof invalidateCachedResourceExactly>[0],
  queryKey: readonly unknown[],
  snapshot: T | undefined,
) {
  if (snapshot === undefined) client.removeQueries({ exact: true, queryKey });
  else client.setQueryData(queryKey, snapshot);
}

function refreshToolConnectorAudit(
  client: Parameters<typeof invalidateCachedResourceExactly>[0],
) {
  return Promise.all([
    invalidateCachedResourceExactly(client, appQueryKeys.auditLogs()),
    invalidateCachedResourceExactly(client, appQueryKeys.tablePages()),
  ]);
}

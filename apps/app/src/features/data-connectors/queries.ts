import {
  dataConnectorsGetCatalog,
  dataConnectorsGetPosture,
  dataConnectorsList,
  dataConnectorsListSyncs,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export async function getDataConnectorCatalog() {
  configureBrowserApiClients();
  const response = await dataConnectorsGetCatalog({ throwOnError: true });
  return response.data.data;
}

export async function getDataConnectorPosture() {
  configureBrowserApiClients();
  const response = await dataConnectorsGetPosture({ throwOnError: true });
  return response.data.data;
}

export async function listDataConnectors(workspaceId: string) {
  configureBrowserApiClients();
  const response = await dataConnectorsList({
    query: { workspaceId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function listDataConnectorSyncs(connectorId: string) {
  configureBrowserApiClients();
  const response = await dataConnectorsListSyncs({
    path: { connectorId },
    throwOnError: true,
  });
  return response.data.data;
}

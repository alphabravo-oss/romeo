import {
  toolConnectorsGetCatalog,
  toolConnectorsList,
  toolConnectorsListOperations,
  type ToolConnector,
  type ToolConnectorCatalogReport,
  type ToolOperation,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export async function listToolConnectors(): Promise<ToolConnector[]> {
  configureBrowserApiClients();
  const response = await toolConnectorsList({ throwOnError: true });
  return response.data.data;
}

export async function listToolOperations(
  connectorId: string,
): Promise<ToolOperation[]> {
  configureBrowserApiClients();
  const response = await toolConnectorsListOperations({
    path: { connectorId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function getToolConnectorCatalog(): Promise<ToolConnectorCatalogReport> {
  configureBrowserApiClients();
  const response = await toolConnectorsGetCatalog({ throwOnError: true });
  return response.data.data;
}

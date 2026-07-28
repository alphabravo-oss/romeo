import {
  dataConnectorsCreate,
  dataConnectorsSync,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

import type { CreateDataConnectorInput } from "./types";

export async function createDataConnector(input: CreateDataConnectorInput) {
  configureBrowserApiClients();
  const response = await dataConnectorsCreate({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function createLocalDataConnector(input: {
  workspaceId: string;
  knowledgeBaseId: string;
  name: string;
}) {
  return createDataConnector({
    ...input,
    type: "local_import",
    config: {},
  });
}

export async function syncLocalDataConnector(input: {
  connectorId: string;
  fileName: string;
  mimeType: string;
  content: string;
}) {
  configureBrowserApiClients();
  const response = await dataConnectorsSync({
    path: { connectorId: input.connectorId },
    body: {
      items: [
        {
          fileName: input.fileName,
          mimeType: input.mimeType,
          content: input.content,
          sizeBytes: new TextEncoder().encode(input.content).length,
        },
      ],
    },
    throwOnError: true,
  });
  return response.data.data;
}

export async function syncDataConnector(input: {
  connectorId: string;
  items?: Array<{
    fileName: string;
    mimeType: string;
    content: string;
    sizeBytes?: number;
  }>;
}) {
  configureBrowserApiClients();
  const response = await dataConnectorsSync({
    path: { connectorId: input.connectorId },
    body: input.items === undefined ? {} : { items: input.items },
    throwOnError: true,
  });
  return response.data.data;
}

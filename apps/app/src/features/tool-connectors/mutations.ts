import {
  toolConnectorsCheckAuth,
  toolConnectorsCreateMcp,
  toolConnectorsCreateWebhook,
  toolConnectorsDispatchOperation,
  toolConnectorsImportOpenApi,
  toolConnectorsTestOperation,
  toolConnectorsUpdate,
  toolConnectorsUpdateAuth,
  toolConnectorsUpdateNetworkPolicy,
  toolConnectorsUpdateOperation,
  type CreateMcpToolRequest,
  type CreateWebhookToolRequest,
  type ImportedToolConnector,
  type ImportOpenApiToolRequest,
  type ToolConnector,
  type ToolConnectorAuthCheck,
  type ToolOperation,
  type ToolOperationDispatchResult,
  type ToolOperationTestPreview,
  type UpdateToolConnectorAuthRequest,
  type UpdateToolConnectorNetworkPolicyRequest,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export async function importOpenApiTool(
  input: ImportOpenApiToolRequest,
): Promise<ImportedToolConnector> {
  configureBrowserApiClients();
  const response = await toolConnectorsImportOpenApi({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function updateToolOperation(input: {
  connectorId: string;
  operationId: string;
  enabled: boolean;
}): Promise<ToolOperation> {
  const { connectorId, operationId, enabled } = input;
  configureBrowserApiClients();
  const response = await toolConnectorsUpdateOperation({
    path: { connectorId, operationId },
    body: { enabled },
    throwOnError: true,
  });
  return response.data.data;
}
export async function testToolOperation(input: {
  connectorId: string;
  operationId: string;
  parameters?: Record<string, unknown>;
  body?: Record<string, unknown>;
}): Promise<ToolOperationTestPreview> {
  const { connectorId, operationId, parameters, body } = input;
  configureBrowserApiClients();
  const response = await toolConnectorsTestOperation({
    path: { connectorId, operationId },
    body: {
      ...(parameters === undefined ? {} : { parameters }),
      ...(body === undefined ? {} : { body }),
    },
    throwOnError: true,
  });
  return response.data.data;
}
export async function dispatchToolOperation(input: {
  connectorId: string;
  operationId: string;
  parameters?: Record<string, unknown>;
  body?: Record<string, unknown>;
  approved?: boolean;
  approvalRequestId?: string;
  idempotencyKey?: string;
}): Promise<ToolOperationDispatchResult> {
  const { connectorId, operationId, ...body } = input;
  configureBrowserApiClients();
  const response = await toolConnectorsDispatchOperation({
    path: { connectorId, operationId },
    body,
    throwOnError: true,
  });
  return response.data.data;
}
export async function createWebhookTool(
  input: CreateWebhookToolRequest,
): Promise<ImportedToolConnector> {
  configureBrowserApiClients();
  const response = await toolConnectorsCreateWebhook({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}
export async function createMcpTool(
  input: CreateMcpToolRequest,
): Promise<ImportedToolConnector> {
  configureBrowserApiClients();
  const response = await toolConnectorsCreateMcp({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}
export async function updateToolConnector(input: {
  connectorId: string;
  enabled: boolean;
}): Promise<ToolConnector> {
  configureBrowserApiClients();
  const response = await toolConnectorsUpdate({
    path: { connectorId: input.connectorId },
    body: { enabled: input.enabled },
    throwOnError: true,
  });
  return response.data.data;
}
export async function updateToolConnectorAuth(
  input: UpdateToolConnectorAuthRequest & { connectorId: string },
): Promise<ToolConnector> {
  const { connectorId, ...body } = input;
  configureBrowserApiClients();
  const response = await toolConnectorsUpdateAuth({
    path: { connectorId },
    body,
    throwOnError: true,
  });
  return response.data.data;
}
export async function checkToolConnectorAuth(
  connectorId: string,
): Promise<ToolConnectorAuthCheck> {
  configureBrowserApiClients();
  const response = await toolConnectorsCheckAuth({
    path: { connectorId },
    throwOnError: true,
  });
  return response.data.data;
}
export async function updateToolConnectorNetworkPolicy(
  input: UpdateToolConnectorNetworkPolicyRequest & { connectorId: string },
): Promise<ToolConnector> {
  const { connectorId, ...body } = input;
  configureBrowserApiClients();
  const response = await toolConnectorsUpdateNetworkPolicy({
    path: { connectorId },
    body,
    throwOnError: true,
  });
  return response.data.data;
}

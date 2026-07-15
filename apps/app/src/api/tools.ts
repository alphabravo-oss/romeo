import { apiJson } from "./http";
import type {
  AgentToolSummary,
  Envelope,
  ImportedToolConnector,
  ToolApprovalDecision,
  ToolApprovalRequest,
  ToolCallRecord,
  ToolConnector,
  ToolConnectorAuthCheck,
  ToolOperation,
  ToolOperationDispatchResult,
  ToolOperationTestPreview,
  ToolSummary,
} from "./types";

export async function listTools(): Promise<ToolSummary[]> {
  const response = await apiJson<Envelope<ToolSummary[]>>("/api/v1/tools");
  return response.data;
}

export async function listAgentTools(
  agentId: string,
): Promise<AgentToolSummary[]> {
  const response = await apiJson<Envelope<AgentToolSummary[]>>(
    `/api/v1/agents/${encodeURIComponent(agentId)}/tools`,
  );
  return response.data;
}

export async function listToolCalls(
  agentId?: string,
): Promise<ToolCallRecord[]> {
  const query =
    agentId === undefined ? "" : `?agentId=${encodeURIComponent(agentId)}`;
  const response = await apiJson<Envelope<ToolCallRecord[]>>(
    `/api/v1/tool-calls${query}`,
  );
  return response.data;
}

export async function listToolApprovals(
  input: { agentId?: string; runId?: string } = {},
): Promise<ToolApprovalRequest[]> {
  const params = new URLSearchParams();
  if (input.agentId !== undefined) params.set("agentId", input.agentId);
  if (input.runId !== undefined) params.set("runId", input.runId);
  const query = params.toString();
  const response = await apiJson<Envelope<ToolApprovalRequest[]>>(
    `/api/v1/tool-approvals${query.length === 0 ? "" : `?${query}`}`,
  );
  return response.data;
}

export async function approveToolApproval(
  approvalRequestId: string,
): Promise<ToolApprovalDecision> {
  const response = await apiJson<Envelope<ToolApprovalDecision>>(
    `/api/v1/tool-approvals/${encodeURIComponent(approvalRequestId)}/approve`,
    { method: "POST" },
  );
  return response.data;
}

export async function cancelToolApproval(
  approvalRequestId: string,
): Promise<ToolApprovalDecision> {
  const response = await apiJson<Envelope<ToolApprovalDecision>>(
    `/api/v1/tool-approvals/${encodeURIComponent(approvalRequestId)}/cancel`,
    { method: "POST" },
  );
  return response.data;
}

export async function rejectToolApproval(
  approvalRequestId: string,
): Promise<ToolApprovalDecision> {
  const response = await apiJson<Envelope<ToolApprovalDecision>>(
    `/api/v1/tool-approvals/${encodeURIComponent(approvalRequestId)}/reject`,
    { method: "POST" },
  );
  return response.data;
}

export async function listToolConnectors(): Promise<ToolConnector[]> {
  const response = await apiJson<Envelope<ToolConnector[]>>(
    "/api/v1/tool-connectors",
  );
  return response.data;
}

export async function importOpenApiTool(input: {
  name: string;
  spec: Record<string, unknown>;
}): Promise<ImportedToolConnector> {
  const response = await apiJson<Envelope<ImportedToolConnector>>(
    "/api/v1/tools/openapi",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return response.data;
}

export async function updateToolConnectorAuth(input: {
  connectorId: string;
  type: "none" | "api_key" | "bearer" | "oauth2_client_credentials";
  secretRef?: string;
  oauthClientAuthMethod?: "client_secret_basic" | "client_secret_post";
  oauthScopes?: string[];
  oauthTokenUrl?: string;
}): Promise<ToolConnector> {
  const body: {
    type: "none" | "api_key" | "bearer" | "oauth2_client_credentials";
    secretRef?: string;
    oauthClientAuthMethod?: "client_secret_basic" | "client_secret_post";
    oauthScopes?: string[];
    oauthTokenUrl?: string;
  } = { type: input.type };
  if (input.secretRef !== undefined) body.secretRef = input.secretRef;
  if (input.oauthClientAuthMethod !== undefined)
    body.oauthClientAuthMethod = input.oauthClientAuthMethod;
  if (input.oauthScopes !== undefined) body.oauthScopes = input.oauthScopes;
  if (input.oauthTokenUrl !== undefined)
    body.oauthTokenUrl = input.oauthTokenUrl;
  const response = await apiJson<Envelope<ToolConnector>>(
    `/api/v1/tool-connectors/${encodeURIComponent(input.connectorId)}/auth`,
    {
      method: "PATCH",
      body: JSON.stringify(body),
    },
  );
  return response.data;
}

export async function updateToolConnector(input: {
  connectorId: string;
  enabled: boolean;
}): Promise<ToolConnector> {
  const response = await apiJson<Envelope<ToolConnector>>(
    `/api/v1/tool-connectors/${encodeURIComponent(input.connectorId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ enabled: input.enabled }),
    },
  );
  return response.data;
}

export async function checkToolConnectorAuth(
  connectorId: string,
): Promise<ToolConnectorAuthCheck> {
  const response = await apiJson<Envelope<ToolConnectorAuthCheck>>(
    `/api/v1/tool-connectors/${encodeURIComponent(connectorId)}/auth/check`,
    {
      method: "POST",
    },
  );
  return response.data;
}

export async function updateToolConnectorNetworkPolicy(input: {
  connectorId: string;
  mode: "deny_all" | "allow_hosts";
  allowedHosts?: string[];
  allowPrivateNetwork?: boolean;
}): Promise<ToolConnector> {
  const response = await apiJson<Envelope<ToolConnector>>(
    `/api/v1/tool-connectors/${encodeURIComponent(input.connectorId)}/network-policy`,
    {
      method: "PATCH",
      body: JSON.stringify({
        mode: input.mode,
        allowedHosts: input.allowedHosts ?? [],
        allowPrivateNetwork: input.allowPrivateNetwork ?? false,
      }),
    },
  );
  return response.data;
}

export async function listToolOperations(
  connectorId: string,
): Promise<ToolOperation[]> {
  const response = await apiJson<Envelope<ToolOperation[]>>(
    `/api/v1/tool-connectors/${encodeURIComponent(connectorId)}/operations`,
  );
  return response.data;
}

export async function updateToolOperation(input: {
  connectorId: string;
  operationId: string;
  enabled: boolean;
}): Promise<ToolOperation> {
  const response = await apiJson<Envelope<ToolOperation>>(
    `/api/v1/tool-connectors/${encodeURIComponent(input.connectorId)}/operations/${encodeURIComponent(input.operationId)}`,
    { method: "PATCH", body: JSON.stringify({ enabled: input.enabled }) },
  );
  return response.data;
}

export async function testToolOperation(input: {
  connectorId: string;
  operationId: string;
  parameters?: Record<string, unknown>;
  body?: Record<string, unknown>;
}): Promise<ToolOperationTestPreview> {
  const body: {
    parameters?: Record<string, unknown>;
    body?: Record<string, unknown>;
  } = {};
  if (input.parameters !== undefined) body.parameters = input.parameters;
  if (input.body !== undefined) body.body = input.body;
  const response = await apiJson<Envelope<ToolOperationTestPreview>>(
    `/api/v1/tool-connectors/${encodeURIComponent(input.connectorId)}/operations/${encodeURIComponent(input.operationId)}/test`,
    { method: "POST", body: JSON.stringify(body) },
  );
  return response.data;
}

export async function dispatchToolOperation(input: {
  connectorId: string;
  operationId: string;
  parameters?: Record<string, unknown>;
  body?: Record<string, unknown>;
  approved?: boolean;
  approvalRequestId?: string;
}): Promise<ToolOperationDispatchResult> {
  const body: {
    parameters?: Record<string, unknown>;
    body?: Record<string, unknown>;
    approved?: boolean;
    approvalRequestId?: string;
  } = {};
  if (input.parameters !== undefined) body.parameters = input.parameters;
  if (input.body !== undefined) body.body = input.body;
  if (input.approved !== undefined) body.approved = input.approved;
  if (input.approvalRequestId !== undefined)
    body.approvalRequestId = input.approvalRequestId;
  const response = await apiJson<Envelope<ToolOperationDispatchResult>>(
    `/api/v1/tool-connectors/${encodeURIComponent(input.connectorId)}/operations/${encodeURIComponent(input.operationId)}/dispatch`,
    { method: "POST", body: JSON.stringify(body) },
  );
  return response.data;
}

export async function updateAgentToolBinding(input: {
  agentId: string;
  toolId: string;
  enabled?: boolean;
  approvalRequired?: boolean;
}): Promise<AgentToolSummary> {
  const body: { enabled?: boolean; approvalRequired?: boolean } = {};
  if (input.enabled !== undefined) body.enabled = input.enabled;
  if (input.approvalRequired !== undefined)
    body.approvalRequired = input.approvalRequired;
  const response = await apiJson<Envelope<AgentToolSummary>>(
    `/api/v1/agents/${encodeURIComponent(input.agentId)}/tools/${encodeURIComponent(input.toolId)}`,
    { method: "PATCH", body: JSON.stringify(body) },
  );
  return response.data;
}

export async function executeTool<TOutput>(input: {
  toolId: string;
  agentId: string;
  runId?: string;
  payload: unknown;
  approved?: boolean;
  approvalRequestId?: string;
}): Promise<TOutput> {
  const body: {
    agentId: string;
    runId?: string;
    input: unknown;
    approved?: boolean;
    approvalRequestId?: string;
  } = { agentId: input.agentId, input: input.payload };
  if (input.runId !== undefined) body.runId = input.runId;
  if (input.approved !== undefined) body.approved = input.approved;
  if (input.approvalRequestId !== undefined)
    body.approvalRequestId = input.approvalRequestId;
  const response = await apiJson<Envelope<TOutput>>(
    `/api/v1/tools/${encodeURIComponent(input.toolId)}/execute`,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
  return response.data;
}

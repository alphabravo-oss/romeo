import { pathId, withQuery } from "../path";
import type { RomeoTransport } from "../transport";
import type {
  AgentToolSummary,
  CancelToolOperationDispatchRequestInput,
  ClaimToolOperationDispatchRequestInput,
  CompleteToolOperationDispatchRequestInput,
  CreateMcpToolInput,
  CreateWebhookToolInput,
  DispatchToolOperationInput,
  EnqueueToolOperationDispatchInput,
  ExecuteRunToolInput,
  ExecuteToolInput,
  ExpireToolOperationDispatchRequestsInput,
  FailToolOperationDispatchRequestInput,
  ImportedToolConnector,
  ImportOpenApiToolInput,
  ReadToolOperationDispatchRequestPayloadInput,
  RenewToolOperationDispatchRequestLeaseInput,
  TestToolOperationInput,
  ToolApprovalDecision,
  ToolApprovalRequest,
  ToolCallRecord,
  ToolConnector,
  ToolConnectorCatalogReport,
  ToolConnectorAuthCheck,
  ToolOperation,
  ToolOperationDispatchRequestPayloadResult,
  ToolOperationDispatchRequestClaimResult,
  ToolOperationDispatchRequestExpiryResult,
  ToolOperationDispatchRequestResult,
  ToolOperationDispatchRequestReadbackResult,
  ToolOperationDispatchResult,
  ToolOperationTestPreview,
  ToolSummary,
  UpdateAgentToolBindingInput,
  UpdateToolConnectorInput,
  UpdateToolConnectorAuthInput,
  UpdateToolConnectorNetworkPolicyInput,
  UpdateToolOperationInput,
} from "../types";

export function createToolResource(transport: RomeoTransport) {
  return {
    list: () => transport.data<ToolSummary[]>("GET", "/api/v1/tools"),
    calls: (agentId?: string) =>
      transport.data<ToolCallRecord[]>(
        "GET",
        withQuery("/api/v1/tool-calls", { agentId }),
      ),
    approvals: (input: { agentId?: string; runId?: string } = {}) =>
      transport.data<ToolApprovalRequest[]>(
        "GET",
        withQuery("/api/v1/tool-approvals", input),
      ),
    approveApproval: (approvalRequestId: string) =>
      transport.data<ToolApprovalDecision>(
        "POST",
        `/api/v1/tool-approvals/${pathId(approvalRequestId)}/approve`,
      ),
    cancelApproval: (approvalRequestId: string) =>
      transport.data<ToolApprovalDecision>(
        "POST",
        `/api/v1/tool-approvals/${pathId(approvalRequestId)}/cancel`,
      ),
    rejectApproval: (approvalRequestId: string) =>
      transport.data<ToolApprovalDecision>(
        "POST",
        `/api/v1/tool-approvals/${pathId(approvalRequestId)}/reject`,
      ),
    connectors: () =>
      transport.data<ToolConnector[]>("GET", "/api/v1/tool-connectors"),
    catalog: () =>
      transport.data<ToolConnectorCatalogReport>(
        "GET",
        "/api/v1/tool-connectors/catalog",
      ),
    importOpenApi: (input: ImportOpenApiToolInput) =>
      transport.data<ImportedToolConnector>(
        "POST",
        "/api/v1/tools/openapi",
        input,
      ),
    createMcpConnector: (input: CreateMcpToolInput) =>
      transport.data<ImportedToolConnector>("POST", "/api/v1/tools/mcp", input),
    createWebhookConnector: (input: CreateWebhookToolInput) =>
      transport.data<ImportedToolConnector>(
        "POST",
        "/api/v1/tools/webhook",
        input,
      ),
    updateConnector: (input: UpdateToolConnectorInput) => {
      const { connectorId, ...body } = input;
      return transport.data<ToolConnector>(
        "PATCH",
        `/api/v1/tool-connectors/${pathId(connectorId)}`,
        body,
      );
    },
    updateConnectorAuth: (input: UpdateToolConnectorAuthInput) => {
      const { connectorId, ...body } = input;
      return transport.data<ToolConnector>(
        "PATCH",
        `/api/v1/tool-connectors/${pathId(connectorId)}/auth`,
        body,
      );
    },
    checkConnectorAuth: (connectorId: string) =>
      transport.data<ToolConnectorAuthCheck>(
        "POST",
        `/api/v1/tool-connectors/${pathId(connectorId)}/auth/check`,
      ),
    updateConnectorNetworkPolicy: (
      input: UpdateToolConnectorNetworkPolicyInput,
    ) => {
      const { connectorId, ...body } = input;
      return transport.data<ToolConnector>(
        "PATCH",
        `/api/v1/tool-connectors/${pathId(connectorId)}/network-policy`,
        body,
      );
    },
    operations: (connectorId: string) =>
      transport.data<ToolOperation[]>(
        "GET",
        `/api/v1/tool-connectors/${pathId(connectorId)}/operations`,
      ),
    updateOperation: (input: UpdateToolOperationInput) => {
      const { connectorId, operationId, ...body } = input;
      return transport.data<ToolOperation>(
        "PATCH",
        `/api/v1/tool-connectors/${pathId(connectorId)}/operations/${pathId(operationId)}`,
        body,
      );
    },
    testOperation: (input: TestToolOperationInput) => {
      const { connectorId, operationId, ...body } = input;
      return transport.data<ToolOperationTestPreview>(
        "POST",
        `/api/v1/tool-connectors/${pathId(connectorId)}/operations/${pathId(operationId)}/test`,
        body,
      );
    },
    dispatchOperation: (input: DispatchToolOperationInput) => {
      const { connectorId, operationId, ...body } = input;
      return transport.data<ToolOperationDispatchResult>(
        "POST",
        `/api/v1/tool-connectors/${pathId(connectorId)}/operations/${pathId(operationId)}/dispatch`,
        body,
      );
    },
    enqueueDispatchOperation: (input: EnqueueToolOperationDispatchInput) => {
      const { connectorId, operationId, ...body } = input;
      return transport.data<ToolOperationDispatchRequestResult>(
        "POST",
        `/api/v1/tool-connectors/${pathId(connectorId)}/operations/${pathId(operationId)}/dispatch-requests`,
        body,
      );
    },
    claimDispatchRequest: (
      input: ClaimToolOperationDispatchRequestInput = {},
    ) =>
      transport.data<ToolOperationDispatchRequestClaimResult>(
        "POST",
        "/api/v1/tool-operation-dispatch-requests/claim",
        input,
      ),
    renewDispatchRequestLease: (
      input: RenewToolOperationDispatchRequestLeaseInput,
    ) => {
      const { jobId, ...body } = input;
      return transport.data<ToolOperationDispatchRequestClaimResult>(
        "POST",
        `/api/v1/tool-operation-dispatch-requests/${pathId(jobId)}/renew-lease`,
        body,
      );
    },
    readDispatchRequestPayload: (
      input: ReadToolOperationDispatchRequestPayloadInput,
    ) =>
      transport.data<ToolOperationDispatchRequestPayloadResult>(
        "POST",
        `/api/v1/tool-operation-dispatch-requests/${pathId(input.jobId)}/payload`,
      ),
    expireDispatchRequests: (
      input: ExpireToolOperationDispatchRequestsInput = {},
    ) =>
      transport.data<ToolOperationDispatchRequestExpiryResult>(
        "POST",
        "/api/v1/tool-operation-dispatch-requests/expire",
        input,
      ),
    completeDispatchRequest: (
      input: CompleteToolOperationDispatchRequestInput,
    ) => {
      const { jobId, ...body } = input;
      return transport.data<ToolOperationDispatchRequestReadbackResult>(
        "POST",
        `/api/v1/tool-operation-dispatch-requests/${pathId(jobId)}/complete`,
        body,
      );
    },
    failDispatchRequest: (input: FailToolOperationDispatchRequestInput) => {
      const { jobId, ...body } = input;
      return transport.data<ToolOperationDispatchRequestReadbackResult>(
        "POST",
        `/api/v1/tool-operation-dispatch-requests/${pathId(jobId)}/fail`,
        body,
      );
    },
    cancelDispatchRequest: (input: CancelToolOperationDispatchRequestInput) => {
      const { jobId, ...body } = input;
      return transport.data<ToolOperationDispatchRequestReadbackResult>(
        "POST",
        `/api/v1/tool-operation-dispatch-requests/${pathId(jobId)}/cancel`,
        body,
      );
    },
    forAgent: (agentId: string) =>
      transport.data<AgentToolSummary[]>(
        "GET",
        `/api/v1/agents/${pathId(agentId)}/tools`,
      ),
    updateAgentBinding: (input: UpdateAgentToolBindingInput) => {
      const { agentId, toolId, ...body } = input;
      return transport.data<AgentToolSummary>(
        "PATCH",
        `/api/v1/agents/${pathId(agentId)}/tools/${pathId(toolId)}`,
        body,
      );
    },
    execute: <TOutput>(input: ExecuteToolInput) => {
      const { toolId, payload, ...body } = input;
      return transport.data<TOutput>(
        "POST",
        `/api/v1/tools/${pathId(toolId)}/execute`,
        { ...body, input: payload },
      );
    },
    executeForRun: <TOutput>(input: ExecuteRunToolInput) => {
      const { runId, toolId, payload, ...body } = input;
      return transport.data<TOutput>(
        "POST",
        `/api/v1/runs/${pathId(runId)}/tools/${pathId(toolId)}/execute`,
        { ...body, input: payload },
      );
    },
  };
}

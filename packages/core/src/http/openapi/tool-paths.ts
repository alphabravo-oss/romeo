import { arrayEnvelope, errorResponse, jsonContent, success } from "./helpers";

export const toolPaths = {
  "/tools": {
    get: {
      summary: "List callable tools",
      responses: { 200: arrayEnvelope("Tool summary"), 403: errorResponse },
    },
  },
  "/agents/{agentId}/tools": {
    get: {
      summary: "List tool bindings for an agent",
      parameters: [{ $ref: "#/components/parameters/AgentId" }],
      responses: {
        200: arrayEnvelope("Agent tool binding"),
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/tool-calls": {
    get: {
      summary: "List recent sanitized tool calls",
      parameters: [
        {
          name: "agentId",
          in: "query",
          required: false,
          schema: { type: "string" },
        },
      ],
      responses: { 200: arrayEnvelope("Tool call trace"), 403: errorResponse },
    },
  },
  "/tool-approvals": {
    get: {
      summary: "List caller pending tool approval requests",
      parameters: [
        {
          name: "agentId",
          in: "query",
          required: false,
          schema: { type: "string" },
        },
        {
          name: "runId",
          in: "query",
          required: false,
          schema: { type: "string" },
        },
      ],
      responses: {
        200: {
          description: "Pending caller-owned tool approval requests",
          content: jsonContent({
            type: "object",
            required: ["data"],
            properties: {
              data: {
                type: "array",
                items: {
                  $ref: "#/components/schemas/ToolApprovalRequest",
                },
              },
            },
          }),
        },
        403: errorResponse,
      },
    },
  },
  "/tool-approvals/{approvalRequestId}/approve": {
    post: {
      summary: "Approve a pending caller-owned tool approval request",
      parameters: [
        {
          name: "approvalRequestId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        200: success("Tool approval approval decision", {
          $ref: "#/components/schemas/ToolApprovalDecision",
        }),
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
      },
    },
  },
  "/tool-approvals/{approvalRequestId}/cancel": {
    post: {
      summary: "Cancel a pending caller-owned tool approval request",
      parameters: [
        {
          name: "approvalRequestId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        200: success("Tool approval cancellation decision", {
          $ref: "#/components/schemas/ToolApprovalDecision",
        }),
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
      },
    },
  },
  "/tool-approvals/{approvalRequestId}/reject": {
    post: {
      summary: "Reject a pending caller-owned tool approval request",
      parameters: [
        {
          name: "approvalRequestId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        200: success("Tool approval rejection decision", {
          $ref: "#/components/schemas/ToolApprovalDecision",
        }),
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
      },
    },
  },
  "/tool-connectors": {
    get: {
      summary: "List imported tool connectors",
      responses: { 200: arrayEnvelope("Tool connector"), 403: errorResponse },
    },
  },
  "/tool-connectors/catalog": {
    get: {
      summary: "Inspect supported tool connector types and execution posture",
      responses: {
        200: success("Tool connector catalog", {
          $ref: "#/components/schemas/ToolConnectorCatalogReport",
        }),
        403: errorResponse,
      },
    },
  },
  "/tool-connectors/{connectorId}": {
    patch: {
      summary: "Update imported tool connector activation",
      parameters: [
        {
          name: "connectorId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/UpdateToolConnectorRequest",
        }),
      },
      responses: {
        200: success("Tool connector"),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/tools/openapi": {
    post: {
      summary: "Import an inline OpenAPI tool connector",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/ImportOpenApiToolRequest",
        }),
      },
      responses: {
        201: success("Imported tool connector"),
        400: errorResponse,
        403: errorResponse,
      },
    },
  },
  "/tools/webhook": {
    post: {
      summary: "Create a single-operation webhook tool connector",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/CreateWebhookToolRequest",
        }),
      },
      responses: {
        201: success("Webhook tool connector"),
        400: errorResponse,
        403: errorResponse,
      },
    },
  },
  "/tools/mcp": {
    post: {
      summary:
        "Create a Streamable HTTP MCP tool connector from a reviewed manifest",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/CreateMcpToolRequest",
        }),
      },
      responses: {
        201: success("MCP tool connector"),
        400: errorResponse,
        403: errorResponse,
      },
    },
  },
  "/tool-connectors/{connectorId}/auth": {
    patch: {
      summary: "Update redacted tool connector auth metadata",
      parameters: [
        {
          name: "connectorId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/UpdateToolConnectorAuthRequest",
        }),
      },
      responses: {
        200: success("Tool connector"),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/tool-connectors/{connectorId}/auth/check": {
    post: {
      summary: "Check redacted tool connector secret availability",
      parameters: [
        {
          name: "connectorId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        200: success("Tool connector auth check"),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/tool-connectors/{connectorId}/network-policy": {
    patch: {
      summary: "Update tool connector network allowlist policy",
      parameters: [
        {
          name: "connectorId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/UpdateToolConnectorNetworkPolicyRequest",
        }),
      },
      responses: {
        200: success("Tool connector"),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/tool-connectors/{connectorId}/operations": {
    get: {
      summary: "List imported tool operations",
      parameters: [
        {
          name: "connectorId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        200: arrayEnvelope("Tool operation"),
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/tool-connectors/{connectorId}/operations/{operationId}": {
    patch: {
      summary: "Update imported tool operation activation",
      parameters: [
        {
          name: "connectorId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "operationId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/UpdateToolOperationRequest",
        }),
      },
      responses: {
        200: success("Tool operation"),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/tool-connectors/{connectorId}/operations/{operationId}/test": {
    post: {
      summary: "Dry-run an imported tool operation without network execution",
      parameters: [
        {
          name: "connectorId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "operationId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/TestToolOperationRequest",
        }),
      },
      responses: {
        200: success("Tool operation dry-run preview"),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/tool-connectors/{connectorId}/operations/{operationId}/dispatch": {
    post: {
      summary:
        "Dispatch an imported tool operation through the external worker boundary",
      parameters: [
        {
          name: "connectorId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "operationId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/EnqueueToolOperationDispatchRequest",
        }),
      },
      responses: {
        200: success("Tool operation dispatch result", {
          $ref: "#/components/schemas/ToolOperationDispatchResult",
        }),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
        502: errorResponse,
        504: errorResponse,
      },
    },
  },
  "/tool-connectors/{connectorId}/operations/{operationId}/dispatch-requests": {
    post: {
      summary:
        "Queue metadata-only imported tool operation dispatch for an external worker",
      parameters: [
        {
          name: "connectorId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "operationId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/DispatchToolOperationRequest",
        }),
      },
      responses: {
        200: success("Tool operation dispatch request", {
          $ref: "#/components/schemas/ToolOperationDispatchRequestResult",
        }),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
      },
    },
  },
  "/tool-operation-dispatch-requests/claim": {
    post: {
      summary: "Claim the next queued imported tool operation dispatch request",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/ClaimToolOperationDispatchRequest",
        }),
      },
      responses: {
        200: success("Tool operation dispatch request claim", {
          $ref: "#/components/schemas/ToolOperationDispatchRequestClaimResult",
        }),
        400: errorResponse,
        403: errorResponse,
      },
    },
  },
  "/tool-operation-dispatch-requests/expire": {
    post: {
      summary:
        "Expire stale queued or lease-timed-out imported tool operation dispatch requests",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/ExpireToolOperationDispatchRequestsRequest",
        }),
      },
      responses: {
        200: success("Expired tool operation dispatch requests", {
          $ref: "#/components/schemas/ToolOperationDispatchRequestExpiryResult",
        }),
        400: errorResponse,
        403: errorResponse,
      },
    },
  },
  "/tool-operation-dispatch-requests/{jobId}/renew-lease": {
    post: {
      summary: "Renew an active imported tool operation dispatch request lease",
      parameters: [
        {
          name: "jobId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/ClaimToolOperationDispatchRequest",
        }),
      },
      responses: {
        200: success("Tool operation dispatch request lease", {
          $ref: "#/components/schemas/ToolOperationDispatchRequestClaimResult",
        }),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
      },
    },
  },
  "/tool-operation-dispatch-requests/{jobId}/payload": {
    post: {
      summary:
        "Read the managed encrypted payload for an active imported tool operation dispatch lease",
      parameters: [
        {
          name: "jobId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        200: success("Tool operation dispatch request payload", {
          $ref: "#/components/schemas/ToolOperationDispatchRequestPayloadResult",
        }),
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
      },
    },
  },
  "/tool-operation-dispatch-requests/{jobId}/complete": {
    post: {
      summary:
        "Mark a claimed tool operation dispatch request completed with sanitized worker metadata",
      parameters: [
        {
          name: "jobId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/CompleteToolOperationDispatchRequest",
        }),
      },
      responses: {
        200: success("Tool operation dispatch request readback", {
          $ref: "#/components/schemas/ToolOperationDispatchRequestReadbackResult",
        }),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
      },
    },
  },
  "/tool-operation-dispatch-requests/{jobId}/fail": {
    post: {
      summary:
        "Mark a claimed tool operation dispatch request failed with sanitized worker metadata",
      parameters: [
        {
          name: "jobId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/FailToolOperationDispatchRequest",
        }),
      },
      responses: {
        200: success("Tool operation dispatch request readback", {
          $ref: "#/components/schemas/ToolOperationDispatchRequestReadbackResult",
        }),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
      },
    },
  },
  "/tool-operation-dispatch-requests/{jobId}/cancel": {
    post: {
      summary:
        "Cancel a queued or running tool operation dispatch request with sanitized metadata",
      parameters: [
        {
          name: "jobId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/CancelToolOperationDispatchRequest",
        }),
      },
      responses: {
        200: success("Tool operation dispatch request cancellation", {
          $ref: "#/components/schemas/ToolOperationDispatchRequestReadbackResult",
        }),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
      },
    },
  },
  "/agents/{agentId}/tools/{toolId}": {
    patch: {
      summary: "Update an agent tool binding",
      parameters: [
        { $ref: "#/components/parameters/AgentId" },
        { $ref: "#/components/parameters/ToolId" },
      ],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/UpdateAgentToolBindingRequest",
        }),
      },
      responses: {
        200: success("Agent tool binding"),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/tools/{toolId}/execute": {
    post: {
      summary: "Execute a governed tool for an agent",
      parameters: [{ $ref: "#/components/parameters/ToolId" }],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/ExecuteToolRequest",
        }),
      },
      responses: {
        200: success("Tool output"),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
      },
    },
  },
};

import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";

const id = z.string().min(1).max(200);
const tags = ["Tools"];

export const ToolSummarySchema = z
  .strictObject({
    id,
    name: z.string(),
    description: z.string(),
    riskLevel: z.string(),
    approvalPolicy: z.string(),
    requiredScopes: z.array(z.string()),
    timeoutMs: z.number().int().positive(),
  })
  .openapi("ToolSummary");
export const AgentToolSummarySchema = ToolSummarySchema.extend({
  agentId: id,
  bound: z.boolean(),
  enabled: z.boolean(),
  approvalRequired: z.boolean(),
  hasAccess: z.boolean(),
}).openapi("AgentToolSummary");
export const ToolCallRecordSchema = z
  .strictObject({
    id,
    agentId: id,
    actorId: id,
    toolId: id,
    status: z.enum(["blocked", "approval_required", "success", "failure"]),
    riskLevel: z.string(),
    approvalRequired: z.boolean(),
    inputKeys: z.array(z.string()),
    outputKeys: z.array(z.string()),
    errorCode: z.string().optional(),
    runId: id.optional(),
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime(),
  })
  .openapi("ToolCallRecord");
export const UpdateAgentToolBindingRequestSchema = z
  .strictObject({
    enabled: z.boolean().optional(),
    approvalRequired: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.enabled !== undefined || value.approvalRequired !== undefined,
    "At least one tool binding field is required.",
  )
  .openapi("UpdateAgentToolBindingRequest");
export const ExecuteToolRequestSchema = z
  .strictObject({
    agentId: id,
    runId: id.optional(),
    input: z.unknown(),
    approved: z.boolean().optional(),
    approvalRequestId: id.optional(),
    idempotencyKey: z.string().min(1).max(200).optional(),
    modelToolCallId: z.string().min(1).max(200).optional(),
  })
  .openapi("ExecuteToolRequest");
export const ExecuteRunToolRequestSchema = z
  .strictObject({
    approved: z.boolean().optional(),
    approvalRequestId: id.optional(),
    modelToolCallId: z.string().min(1).max(200).optional(),
    input: z.unknown(),
  })
  .openapi("ExecuteRunToolRequest");

const agentParams = z.strictObject({ agentId: id });
const bindingParams = z.strictObject({ agentId: id, toolId: id });

export const listToolsRoute = createRoute({
  method: "get",
  path: "/api/v1/tools",
  operationId: "tools.list",
  tags,
  summary: "List callable tools",
  security: authenticationSecurity,
  responses: {
    200: jsonResponse(
      "Callable tools",
      dataEnvelope(z.array(ToolSummarySchema)),
    ),
    ...standardErrorResponses,
  },
});
export const listToolCallsRoute = createRoute({
  method: "get",
  path: "/api/v1/tool-calls",
  operationId: "tools.listCalls",
  tags,
  summary: "List recent sanitized tool calls",
  security: authenticationSecurity,
  request: { query: z.strictObject({ agentId: id.optional() }) },
  responses: {
    200: jsonResponse(
      "Sanitized tool calls",
      dataEnvelope(z.array(ToolCallRecordSchema)),
    ),
    ...standardErrorResponses,
  },
});
export const listAgentToolsRoute = createRoute({
  method: "get",
  path: "/api/v1/agents/{agentId}/tools",
  operationId: "tools.listAgentBindings",
  tags,
  summary: "List tool bindings for an agent",
  security: authenticationSecurity,
  request: { params: agentParams },
  responses: {
    200: jsonResponse(
      "Agent tool bindings",
      dataEnvelope(z.array(AgentToolSummarySchema)),
    ),
    ...standardErrorResponses,
  },
});
export const updateAgentToolBindingRoute = createRoute({
  method: "patch",
  path: "/api/v1/agents/{agentId}/tools/{toolId}",
  operationId: "tools.updateAgentBinding",
  tags,
  summary: "Update an agent tool binding",
  security: authenticationSecurity,
  request: {
    params: bindingParams,
    body: {
      required: true,
      content: {
        "application/json": { schema: UpdateAgentToolBindingRequestSchema },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "Agent tool binding",
      dataEnvelope(AgentToolSummarySchema),
    ),
    ...standardErrorResponses,
  },
});
export const executeToolRoute = createRoute({
  method: "post",
  path: "/api/v1/tools/{toolId}/execute",
  operationId: "tools.execute",
  tags,
  summary: "Execute a governed tool for an agent",
  security: authenticationSecurity,
  request: {
    params: z.strictObject({ toolId: id }),
    body: {
      required: true,
      content: { "application/json": { schema: ExecuteToolRequestSchema } },
    },
  },
  responses: {
    200: jsonResponse("Tool output", dataEnvelope(z.unknown())),
    ...standardErrorResponses,
  },
});
export const executeRunToolRoute = createRoute({
  method: "post",
  path: "/api/v1/runs/{runId}/tools/{toolId}/execute",
  operationId: "tools.executeForRun",
  tags,
  summary: "Execute a model-requested tool call for a run",
  security: authenticationSecurity,
  request: {
    params: z.strictObject({ runId: id, toolId: id }),
    body: {
      required: true,
      content: { "application/json": { schema: ExecuteRunToolRequestSchema } },
    },
  },
  responses: {
    200: jsonResponse("Tool output", dataEnvelope(z.unknown())),
    ...standardErrorResponses,
  },
});

export const toolCatalogRoutes = [
  listToolsRoute,
  listToolCallsRoute,
  listAgentToolsRoute,
  updateAgentToolBindingRoute,
  executeToolRoute,
  executeRunToolRoute,
] as const;

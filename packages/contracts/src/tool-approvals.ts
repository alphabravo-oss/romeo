import { createRoute, z } from "@hono/zod-openapi";

import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";

const id = z.string().min(1).max(200);
const dateTime = z.string().datetime();
const tags = ["Tool approvals"];

export const ToolApprovalRequestSchema = z
  .strictObject({
    id,
    orgId: id,
    approvalRequestId: id,
    approvalRequired: z.literal(true),
    actorId: id,
    availableActions: z.array(z.enum(["approve", "cancel", "reject"])),
    completedAt: dateTime,
    errorCode: z.string().optional(),
    expiresAt: dateTime,
    inputKeys: z.array(z.string()),
    outputKeys: z.array(z.string()),
    requestedAt: dateTime,
    riskLevel: z.string(),
    source: z.enum(["tool_call", "operation_dispatch"]),
    startedAt: dateTime,
    status: z.literal("approval_required"),
    toolId: id,
    agentId: id.optional(),
    context: z
      .strictObject({
        bodyKeys: z.array(z.string()),
        connectorId: id,
        method: z.string(),
        operationId: id,
        parameterKeys: z.array(z.string()),
        path: z.string(),
        agentId: id.optional(),
        runId: id.optional(),
        workspaceId: id.optional(),
      })
      .optional(),
    runId: id.optional(),
    tool: z.strictObject({
      id,
      approvalPolicy: z.string(),
      description: z.string(),
      kind: z.enum(["built_in", "imported_operation", "unknown"]),
      name: z.string(),
      riskLevel: z.string(),
      connectorId: id.optional(),
      method: z.string().optional(),
      operationId: id.optional(),
      path: z.string().optional(),
    }),
    workspaceId: id.optional(),
  })
  .openapi("ToolApprovalRequest");

export const ToolApprovalDecisionSchema = z
  .strictObject({
    approvedAt: dateTime.optional(),
    approvalRequestId: id,
    cancelledAt: dateTime.optional(),
    decidedAt: dateTime,
    rejectedAt: dateTime.optional(),
    status: z.enum(["approved", "cancelled", "rejected"]),
    toolId: id,
    agentId: id.optional(),
    runId: id.optional(),
    workspaceId: id.optional(),
  })
  .openapi("ToolApprovalDecision");

const approvalParams = z.strictObject({ approvalRequestId: id });
const listQuery = z.strictObject({
  agentId: id.optional(),
  runId: id.optional(),
});
const decisionResponses = {
  200: jsonResponse(
    "Tool approval decision",
    dataEnvelope(ToolApprovalDecisionSchema),
  ),
  ...standardErrorResponses,
};

export const listToolApprovalsRoute = createRoute({
  method: "get",
  path: "/api/v1/tool-approvals",
  operationId: "toolApprovals.list",
  tags,
  summary: "List caller-owned pending tool approvals",
  security: authenticationSecurity,
  request: { query: listQuery },
  responses: {
    200: jsonResponse(
      "Pending tool approvals",
      dataEnvelope(z.array(ToolApprovalRequestSchema)),
    ),
    ...standardErrorResponses,
  },
});
export const approveToolApprovalRoute = createRoute({
  method: "post",
  path: "/api/v1/tool-approvals/{approvalRequestId}/approve",
  operationId: "toolApprovals.approve",
  tags,
  summary: "Approve a pending tool approval",
  security: authenticationSecurity,
  request: { params: approvalParams },
  responses: decisionResponses,
});
export const cancelToolApprovalRoute = createRoute({
  method: "post",
  path: "/api/v1/tool-approvals/{approvalRequestId}/cancel",
  operationId: "toolApprovals.cancel",
  tags,
  summary: "Cancel a pending tool approval",
  security: authenticationSecurity,
  request: { params: approvalParams },
  responses: decisionResponses,
});
export const rejectToolApprovalRoute = createRoute({
  method: "post",
  path: "/api/v1/tool-approvals/{approvalRequestId}/reject",
  operationId: "toolApprovals.reject",
  tags,
  summary: "Reject a pending tool approval",
  security: authenticationSecurity,
  request: { params: approvalParams },
  responses: decisionResponses,
});

export const toolApprovalRoutes = [
  listToolApprovalsRoute,
  approveToolApprovalRoute,
  cancelToolApprovalRoute,
  rejectToolApprovalRoute,
] as const;

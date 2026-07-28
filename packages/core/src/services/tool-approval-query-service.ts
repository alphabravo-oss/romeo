import { assertScope, hasWorkspaceAccess, type AuthSubject } from "@romeo/auth";

import type { BackgroundJob, ToolCallRecord } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import type { ToolCatalogService } from "./tool-catalog-service";
import type {
  OperationToolContext,
  ToolApprovalRequestSummary,
} from "./tool-service-contracts";
import {
  TOOL_APPROVAL_TTL_MS,
  operationApprovalConsumed,
  operationApprovalDecision,
  operationApprovalExpired,
  optionalStringProperty,
  stringArrayPayload,
  stringPayload,
  stringPayloadOptional,
  toolApprovalConsumed,
  toolApprovalDecision,
  toolApprovalExpired,
} from "./tool-service-helpers";

export class ToolApprovalQueryService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly catalog: ToolCatalogService,
  ) {}

  async listPending(
    subject: AuthSubject,
    input: { agentId?: string; runId?: string } = {},
  ): Promise<ToolApprovalRequestSummary[]> {
    assertScope(subject, "tools:use");
    if (input.agentId !== undefined)
      await this.catalog.getAgentForSubject(subject, input.agentId);
    const [calls, jobs, operationTools] = await Promise.all([
      this.repository.listToolCalls(subject.orgId),
      this.repository.listBackgroundJobs(subject.orgId),
      this.catalog.listOperationTools(subject),
    ]);
    const toolCallApprovals = calls
      .filter((call) => call.status === "approval_required")
      .filter((call) => call.actorId === subject.id)
      .filter((call) => hasWorkspaceAccess(subject, call.workspaceId))
      .filter(
        (call) => input.agentId === undefined || call.agentId === input.agentId,
      )
      .filter((call) => input.runId === undefined || call.runId === input.runId)
      .filter((call) => !toolApprovalExpired(call))
      .filter((call) => !toolApprovalConsumed(call, calls))
      .filter((call) => toolApprovalDecision(call, jobs) === undefined)
      .map((call) => this.toToolCallSummary(call, operationTools));
    const operationApprovals = jobs
      .filter((job) => job.type === "tool.operation.approval_request")
      .filter((job) => job.status === "completed")
      .filter((job) => job.payload.actorId === subject.id)
      .filter((job) => {
        const workspaceId = stringPayloadOptional(job.payload, "workspaceId");
        return (
          workspaceId === undefined || hasWorkspaceAccess(subject, workspaceId)
        );
      })
      .filter(
        (job) =>
          input.agentId === undefined || job.payload.agentId === input.agentId,
      )
      .filter(
        (job) => input.runId === undefined || job.payload.runId === input.runId,
      )
      .filter((job) => !operationApprovalExpired(job))
      .filter((job) => !operationApprovalConsumed(job))
      .filter((job) => operationApprovalDecision(job) === undefined)
      .map((job) => this.toOperationSummary(job, operationTools));
    return [...toolCallApprovals, ...operationApprovals].sort(
      (left, right) =>
        right.requestedAt.localeCompare(left.requestedAt) ||
        left.id.localeCompare(right.id),
    );
  }

  private toToolCallSummary(
    call: ToolCallRecord,
    operationTools: OperationToolContext[],
  ): ToolApprovalRequestSummary {
    const builtIn = this.catalog.findBuiltIn(call.toolId);
    const operationTool = operationTools.find(
      (item) => item.tool.id === call.toolId,
    );
    const tool =
      builtIn !== undefined
        ? {
            id: builtIn.id,
            approvalPolicy: builtIn.approvalPolicy,
            description: builtIn.description,
            kind: "built_in" as const,
            name: builtIn.name,
            riskLevel: builtIn.riskLevel,
          }
        : operationTool !== undefined
          ? {
              id: operationTool.tool.id,
              approvalPolicy: operationTool.operation.approvalPolicy,
              connectorId: operationTool.connector.id,
              description: operationTool.tool.description,
              kind: "imported_operation" as const,
              method: operationTool.operation.method,
              name: operationTool.tool.name,
              operationId: operationTool.operation.operationId,
              path: operationTool.operation.path,
              riskLevel: operationTool.operation.riskLevel,
            }
          : {
              id: call.toolId,
              approvalPolicy: "unknown",
              description: "Tool approval request",
              kind: "unknown" as const,
              name: call.toolId,
              riskLevel: call.riskLevel,
            };
    return {
      ...call,
      approvalRequestId: call.id,
      approvalRequired: true,
      availableActions: ["approve", "cancel", "reject"],
      expiresAt: new Date(
        new Date(call.completedAt).getTime() + TOOL_APPROVAL_TTL_MS,
      ).toISOString(),
      requestedAt: call.completedAt,
      source: "tool_call",
      status: "approval_required",
      tool,
    };
  }

  private toOperationSummary(
    job: BackgroundJob,
    operationTools: OperationToolContext[],
  ): ToolApprovalRequestSummary {
    const payload = job.payload;
    const connectorId = stringPayload(payload, "connectorId");
    const operationId = stringPayload(payload, "operationId");
    const method = stringPayload(payload, "method");
    const path = stringPayload(payload, "path");
    const parameterKeys = stringArrayPayload(payload, "parameterKeys");
    const bodyKeys = stringArrayPayload(payload, "bodyKeys");
    const operationTool = operationTools.find(
      (item) =>
        item.connector.id === connectorId &&
        item.operation.operationId === operationId,
    );
    const completedAt = job.completedAt ?? job.updatedAt;
    const requestedAt = job.createdAt;
    const toolId =
      stringPayloadOptional(payload, "toolId") ??
      operationTool?.tool.id ??
      `operation:${connectorId}:${operationId}`;
    const riskLevel =
      stringPayloadOptional(payload, "riskLevel") ??
      operationTool?.operation.riskLevel ??
      "unknown";
    return {
      id: job.id,
      orgId: job.orgId,
      approvalRequestId: job.id,
      approvalRequired: true,
      actorId: stringPayload(payload, "actorId"),
      availableActions: ["approve", "cancel", "reject"],
      completedAt,
      expiresAt: new Date(
        new Date(requestedAt).getTime() + TOOL_APPROVAL_TTL_MS,
      ).toISOString(),
      inputKeys: [
        ...parameterKeys.map((key) => `parameters.${key}`),
        ...bodyKeys.map((key) => `body.${key}`),
      ],
      outputKeys: [],
      requestedAt,
      riskLevel,
      source: "operation_dispatch",
      startedAt: job.createdAt,
      status: "approval_required",
      toolId,
      ...optionalStringProperty(payload, "agentId"),
      context: {
        connectorId,
        operationId,
        method,
        path,
        parameterKeys,
        bodyKeys,
        ...optionalStringProperty(payload, "agentId"),
        ...optionalStringProperty(payload, "runId"),
        ...optionalStringProperty(payload, "workspaceId"),
      },
      ...optionalStringProperty(payload, "runId"),
      tool: {
        id: toolId,
        approvalPolicy:
          stringPayloadOptional(payload, "approvalPolicy") ??
          operationTool?.operation.approvalPolicy ??
          "unknown",
        connectorId,
        description:
          operationTool?.tool.description ??
          `${method.toUpperCase()} ${path} approval request`,
        kind: "imported_operation",
        method,
        name: operationTool?.tool.name ?? operationId,
        operationId,
        path,
        riskLevel,
      },
      ...optionalStringProperty(payload, "workspaceId"),
    };
  }
}

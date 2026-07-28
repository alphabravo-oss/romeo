import type { AuthSubject } from "@romeo/auth";
import type { ToolDefinition } from "@romeo/tools";
import { createHash } from "node:crypto";

import type {
  AgentToolBinding,
  BackgroundJob,
  ToolCallRecord,
  ToolConnector,
  ToolOperation,
  ToolOperationDispatchRequestResult,
} from "../domain/entities";
import { ApiError } from "../errors";
import { objectKeys, toolAuditMetadata } from "./tool-execution";
import type {
  ToolApprovalDecisionResult,
  ToolApprovalDecisionStatus,
  ToolExecutionIdempotencyInput,
} from "./tool-service-contracts";

export const TOOL_APPROVAL_TTL_MS = 15 * 60 * 1000;

export function toolApprovalDecision(
  approval: ToolCallRecord,
  jobs: BackgroundJob[],
): ToolApprovalDecisionResult | undefined {
  const job = jobs.find(
    (item) =>
      item.type === "tool.approval.decision" &&
      item.status === "completed" &&
      item.payload.approvalRequestId === approval.id &&
      toolApprovalDecisionStatus(item.payload.decision) !== undefined,
  );
  return job === undefined ? undefined : toolApprovalDecisionFromJob(job);
}

export function toolApprovalDecisionFromJob(
  job: BackgroundJob,
): ToolApprovalDecisionResult {
  const payload = job.payload;
  const status = toolApprovalDecisionStatus(payload.decision) ?? "rejected";
  const decidedAt = stringPayload(
    payload,
    toolApprovalDecisionTimestampKey(status),
  );
  const result: ToolApprovalDecisionResult = {
    agentId: stringPayload(payload, "agentId"),
    approvalRequestId: stringPayload(payload, "approvalRequestId"),
    decidedAt,
    status,
    toolId: stringPayload(payload, "toolId"),
    workspaceId: stringPayload(payload, "workspaceId"),
    ...toolApprovalDecisionTimestampProperty(status, decidedAt),
  };
  const runId = stringPayloadOptional(payload, "runId");
  if (runId !== undefined) result.runId = runId;
  return result;
}

export function toolApprovalDecisionJob(
  subject: AuthSubject,
  approval: ToolCallRecord,
  decision: ToolApprovalDecisionStatus,
  decidedAt: string,
): BackgroundJob {
  return {
    id: toolApprovalDecisionJobId(subject.orgId, approval.id, decision),
    orgId: subject.orgId,
    workspaceId: approval.workspaceId,
    type: "tool.approval.decision",
    status: "completed",
    payload: {
      schemaVersion: "romeo.tool-approval-decision.v1",
      decision,
      actorId: subject.id,
      approvalRequestId: approval.id,
      workspaceId: approval.workspaceId,
      agentId: approval.agentId,
      toolId: approval.toolId,
      [toolApprovalDecisionTimestampKey(decision)]: decidedAt,
      ...(approval.runId === undefined ? {} : { runId: approval.runId }),
    },
    createdAt: decidedAt,
    updatedAt: decidedAt,
    completedAt: decidedAt,
  };
}

function toolApprovalDecisionJobId(
  orgId: string,
  approvalRequestId: string,
  decision: ToolApprovalDecisionStatus,
): string {
  return `job_tool_approval_decision_${createHash("sha256")
    .update(`${orgId}:${approvalRequestId}:${decision}`)
    .digest("hex")
    .slice(0, 32)}`;
}

function toolApprovalDecisionStatus(
  value: unknown,
): ToolApprovalDecisionStatus | undefined {
  return value === "approved" || value === "cancelled" || value === "rejected"
    ? value
    : undefined;
}

export function toolApprovalDecisionTimestampKey(
  decision: ToolApprovalDecisionStatus,
): "approvedAt" | "cancelledAt" | "rejectedAt" {
  if (decision === "approved") return "approvedAt";
  if (decision === "cancelled") return "cancelledAt";
  return "rejectedAt";
}

export function toolApprovalDecisionActorKey(
  decision: ToolApprovalDecisionStatus,
): "approvedBy" | "cancelledBy" | "rejectedBy" {
  if (decision === "approved") return "approvedBy";
  if (decision === "cancelled") return "cancelledBy";
  return "rejectedBy";
}

export function toolApprovalDecisionTimestampProperty(
  decision: ToolApprovalDecisionStatus,
  value: string,
): { approvedAt?: string; cancelledAt?: string; rejectedAt?: string } {
  if (decision === "approved") return { approvedAt: value };
  if (decision === "cancelled") return { cancelledAt: value };
  return { rejectedAt: value };
}

export function toolApprovalAuditAction(
  decision: ToolApprovalDecisionStatus,
): "tool.approval.approve" | "tool.approval.cancel" | "tool.approval.reject" {
  if (decision === "approved") return "tool.approval.approve";
  if (decision === "cancelled") return "tool.approval.cancel";
  return "tool.approval.reject";
}

export function toolOperationApprovalAuditAction(
  decision: ToolApprovalDecisionStatus,
):
  | "tool.operation.approval.approve"
  | "tool.operation.approval.cancel"
  | "tool.operation.approval.reject" {
  if (decision === "approved") return "tool.operation.approval.approve";
  if (decision === "cancelled") return "tool.operation.approval.cancel";
  return "tool.operation.approval.reject";
}

export function toolApprovalDecisionErrorCode(
  decision: ToolApprovalDecisionStatus,
): "tool_approval_cancelled" | "tool_approval_rejected" {
  return decision === "cancelled"
    ? "tool_approval_cancelled"
    : "tool_approval_rejected";
}

export function toolOperationApprovalDecisionErrorCode(
  decision: ToolApprovalDecisionStatus,
): "tool_operation_approval_cancelled" | "tool_operation_approval_rejected" {
  return decision === "cancelled"
    ? "tool_operation_approval_cancelled"
    : "tool_operation_approval_rejected";
}

export function operationApprovalRequired(
  binding: AgentToolBinding | undefined,
  operation: ToolOperation,
): boolean {
  return (
    binding?.approvalRequired === true || operation.approvalPolicy !== "never"
  );
}

export function toolApprovalExpired(call: ToolCallRecord): boolean {
  return (
    Date.now() - new Date(call.completedAt).getTime() > TOOL_APPROVAL_TTL_MS
  );
}

export function operationApprovalExpired(job: BackgroundJob): boolean {
  return Date.now() - new Date(job.createdAt).getTime() > TOOL_APPROVAL_TTL_MS;
}

export function operationApprovalConsumed(job: BackgroundJob): boolean {
  return typeof job.payload.consumedAt === "string";
}

export function operationApprovalDecision(
  job: BackgroundJob,
): ToolApprovalDecisionStatus | undefined {
  if (typeof job.payload.approvedAt === "string") return "approved";
  if (typeof job.payload.cancelledAt === "string") return "cancelled";
  if (typeof job.payload.rejectedAt === "string") return "rejected";
  return toolApprovalDecisionStatus(job.payload.decision);
}

export function toolApprovalConsumed(
  approval: ToolCallRecord,
  calls: ToolCallRecord[],
): boolean {
  return calls.some(
    (call) =>
      call.id !== approval.id &&
      call.actorId === approval.actorId &&
      call.agentId === approval.agentId &&
      call.toolId === approval.toolId &&
      call.runId === approval.runId &&
      call.completedAt >= approval.completedAt &&
      call.status === "success",
  );
}

export function operationToolAuditMetadata(
  tool: ToolDefinition,
  input: unknown,
  agentId: string,
  binding: AgentToolBinding | undefined,
  connector: ToolConnector,
  operation: ToolOperation,
): Record<string, unknown> {
  return {
    ...toolAuditMetadata(tool, input, agentId, binding),
    connectorId: connector.id,
    operationId: operation.operationId,
    method: operation.method,
    path: operation.path,
    payloadStorage: "external_worker_secret_store_required",
  };
}

export function operationDispatchModelOutput(
  dispatch: ToolOperationDispatchRequestResult,
): Record<string, unknown> {
  return {
    dispatch: "queued",
    jobId: dispatch.job.id,
    jobStatus: dispatch.job.status,
    connectorId: dispatch.connectorId,
    operationId: dispatch.operationId,
    method: dispatch.method,
    pathTemplate: dispatch.pathTemplate,
    workerQueue: dispatch.workerQueue,
    request: dispatch.request,
    approval: dispatch.approval,
    ...(dispatch.idempotency === undefined
      ? {}
      : { idempotency: dispatch.idempotency }),
  };
}

export function stringDetail(
  details: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = details[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function stringPayload(
  payload: Record<string, unknown>,
  key: string,
): string {
  return stringPayloadOptional(payload, key) ?? "";
}

export function stringPayloadOptional(
  payload: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function stringArrayPayload(
  payload: Record<string, unknown>,
  key: string,
): string[] {
  const value = payload[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").sort()
    : [];
}

export function optionalStringProperty(
  payload: Record<string, unknown>,
  key: "agentId" | "runId" | "workspaceId",
): { agentId?: string; runId?: string; workspaceId?: string } {
  const value = stringPayloadOptional(payload, key);
  return value === undefined ? {} : { [key]: value };
}

export function assertRunToolExecutionAllowed(
  run: { id: string; status: string } | undefined,
  options: {
    approved?: boolean | undefined;
    approvalRequestId?: string | undefined;
  },
): void {
  if (run === undefined || run.status === "running") return;
  if (run.status === "waiting_tool_approval") {
    if (options.approved === true && options.approvalRequestId !== undefined)
      return;
    throw new ApiError(
      "run_tool_execution_waiting_approval",
      "Run-scoped tool execution is waiting for the pending approval request.",
      409,
      { runId: run.id, status: run.status },
    );
  }
  throw new ApiError(
    "run_tool_execution_not_active",
    "Run-scoped tool execution requires an active run.",
    409,
    { runId: run.id, status: run.status },
  );
}

export function toolExecutionIdempotencyJob(
  input: ToolExecutionIdempotencyInput,
  now: string,
): BackgroundJob {
  const idempotencyKeyHash = toolExecutionIdempotencyHash(input);
  return {
    id: `job_tool_execution_${idempotencyKeyHash.slice(0, 32)}`,
    orgId: input.subject.orgId,
    workspaceId: input.agent.workspaceId,
    type: "tool.execution.idempotency",
    status: "completed",
    payload: {
      agentId: input.agent.id,
      actorId: input.subject.id,
      idempotencyKeyHash,
      inputKeys: objectKeys(input.requestInput),
      purpose: "model_tool_call_duplicate_guard",
      runId: input.runId ?? null,
      toolId: input.tool.id,
    },
    createdAt: now,
    updatedAt: now,
    completedAt: now,
  };
}

function toolExecutionIdempotencyHash(
  input: Omit<ToolExecutionIdempotencyInput, "requestInput">,
): string {
  return createHash("sha256")
    .update("tool.execution.idempotency.v1")
    .update("\0")
    .update(input.subject.orgId)
    .update("\0")
    .update(input.subject.id)
    .update("\0")
    .update(input.agent.id)
    .update("\0")
    .update(input.tool.id)
    .update("\0")
    .update(input.runId ?? "")
    .update("\0")
    .update(input.idempotencyKey)
    .digest("hex");
}

export function toolExecutionReplayError(
  toolId: string,
  runId: string | undefined,
): ApiError {
  return new ApiError(
    "tool_execution_replayed",
    "Tool execution idempotency key was already used.",
    409,
    { toolId, ...(runId === undefined ? {} : { runId }) },
  );
}

export function isToolExecutionReplayError(error: unknown): boolean {
  return error instanceof ApiError && error.code === "tool_execution_replayed";
}

export function isUniqueConstraintError(error: unknown): boolean {
  const candidate = error as { cause?: { code?: unknown }; code?: unknown };
  return candidate.code === "23505" || candidate.cause?.code === "23505";
}

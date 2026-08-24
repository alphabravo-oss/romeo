import type { AuthSubject } from "@romeo/auth";
import { createHash } from "node:crypto";

import { canonicalJson, sha256 } from "../domain/audit-integrity";
import type {
  BackgroundJob,
  ToolCallRecord,
  ToolConnector,
  ToolOperation,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import type { DispatchToolOperationInput } from "./tool-operation-dispatch-types";
import { isUniqueConstraintError } from "./tool-service-helpers";

const TOOL_APPROVAL_BINDING_SCHEMA = "romeo.tool-approval-binding.v1";
const TOOL_APPROVAL_CONSUMPTION_SCHEMA = "romeo.tool-approval-consumption.v1";
const OPERATION_APPROVAL_DIGEST_SCHEMA =
  "romeo.tool-operation-approval-digest.v1";
const OPERATION_APPROVAL_CONSUMPTION_SCHEMA =
  "romeo.tool-operation-approval-consumption.v1";
const approvalCriticalSections = new Map<string, Promise<void>>();

export async function withApprovalCriticalSection<T>(
  orgId: string,
  approvalRequestId: string,
  work: () => Promise<T>,
): Promise<T> {
  const key = `${orgId}\0${approvalRequestId}`;
  const previous = approvalCriticalSections.get(key) ?? Promise.resolve();
  let release = (): void => undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => current);
  approvalCriticalSections.set(key, tail);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (approvalCriticalSections.get(key) === tail)
      approvalCriticalSections.delete(key);
  }
}

export function toolApprovalBindingJob(
  approval: ToolCallRecord,
  requestInput: unknown,
): BackgroundJob {
  const createdAt = approval.completedAt;
  return {
    id: approvalArtifactId("binding", approval.orgId, approval.id),
    orgId: approval.orgId,
    workspaceId: approval.workspaceId,
    type: "tool.approval.binding",
    status: "completed",
    payload: {
      schemaVersion: TOOL_APPROVAL_BINDING_SCHEMA,
      approvalRequestId: approval.id,
      actorId: approval.actorId,
      agentId: approval.agentId,
      toolId: approval.toolId,
      workspaceId: approval.workspaceId,
      runId: approval.runId ?? null,
      requestDigest: toolApprovalRequestDigest(approval, requestInput),
      digestAlgorithm: "sha256",
    },
    createdAt,
    updatedAt: createdAt,
    completedAt: createdAt,
  };
}

export function toolApprovalRequestDigest(
  approval: ToolCallRecord,
  requestInput: unknown,
): string {
  return sha256(
    canonicalJson({
      schemaVersion: TOOL_APPROVAL_BINDING_SCHEMA,
      orgId: approval.orgId,
      workspaceId: approval.workspaceId,
      actorId: approval.actorId,
      agentId: approval.agentId,
      toolId: approval.toolId,
      runId: approval.runId ?? null,
      requestInput,
    }),
  );
}

export function validToolApprovalBinding(
  approval: ToolCallRecord,
  requestInput: unknown,
  jobs: BackgroundJob[],
): boolean {
  const binding = jobs.find(
    (job) =>
      job.type === "tool.approval.binding" &&
      job.status === "completed" &&
      job.payload.approvalRequestId === approval.id,
  );
  return (
    binding?.orgId === approval.orgId &&
    binding.workspaceId === approval.workspaceId &&
    binding.payload.schemaVersion === TOOL_APPROVAL_BINDING_SCHEMA &&
    binding.payload.actorId === approval.actorId &&
    binding.payload.agentId === approval.agentId &&
    binding.payload.toolId === approval.toolId &&
    binding.payload.workspaceId === approval.workspaceId &&
    binding.payload.runId === (approval.runId ?? null) &&
    binding.payload.requestDigest ===
      toolApprovalRequestDigest(approval, requestInput)
  );
}

export function toolApprovalConsumed(
  approval: ToolCallRecord,
  calls: ToolCallRecord[],
  jobs: BackgroundJob[],
): boolean {
  if (
    jobs.some(
      (job) =>
        job.type === "tool.approval.consumption" &&
        job.status === "completed" &&
        job.payload.approvalRequestId === approval.id,
    )
  )
    return true;
  // Read legacy records conservatively during rolling upgrades.
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

export async function consumeToolApproval(input: {
  approval: ToolCallRecord;
  repository: RomeoRepository;
  requestDigest: string;
  subject: AuthSubject;
}): Promise<void> {
  const now = new Date().toISOString();
  const marker: BackgroundJob = {
    id: approvalArtifactId(
      "consumption",
      input.approval.orgId,
      input.approval.id,
    ),
    orgId: input.approval.orgId,
    workspaceId: input.approval.workspaceId,
    type: "tool.approval.consumption",
    status: "completed",
    payload: {
      schemaVersion: TOOL_APPROVAL_CONSUMPTION_SCHEMA,
      approvalRequestId: input.approval.id,
      actorId: input.subject.id,
      requestDigest: input.requestDigest,
      consumedAt: now,
    },
    createdAt: now,
    updatedAt: now,
    completedAt: now,
  };
  try {
    await input.repository.createBackgroundJob(marker);
  } catch (error) {
    if (!isUniqueConstraintError(error) && !isInMemoryDuplicate(error))
      throw error;
    throw new ApiError(
      "tool_approval_request_consumed",
      "Tool approval request was already consumed.",
      409,
      { approvalRequestId: input.approval.id },
    );
  }
}

export function dispatchApprovalRequestDigest(
  input: Pick<
    DispatchToolOperationInput,
    "body" | "connector" | "operation" | "parameters" | "subject"
  > & {
    runContext?: {
      agentId: string;
      runId: string;
      toolId: string;
      workspaceId: string;
    };
  },
): string {
  return sha256(
    canonicalJson({
      schemaVersion: OPERATION_APPROVAL_DIGEST_SCHEMA,
      orgId: input.subject.orgId,
      actorId: input.subject.id,
      connector: approvalConnectorScope(input.connector),
      operation: approvalOperationScope(input.operation),
      parameters: input.parameters ?? null,
      body: input.body ?? null,
      runContext: input.runContext ?? null,
    }),
  );
}

export function operationApprovalConsumed(
  approval: BackgroundJob,
  jobs: BackgroundJob[],
): boolean {
  return (
    typeof approval.payload.consumedAt === "string" ||
    jobs.some(
      (job) =>
        job.type === "tool.operation.approval.consumption" &&
        job.status === "completed" &&
        job.payload.approvalRequestId === approval.id,
    )
  );
}

export async function consumeOperationApproval(input: {
  approval: BackgroundJob;
  repository: RomeoRepository;
  requestDigest: string;
  subject: AuthSubject;
}): Promise<void> {
  const now = new Date().toISOString();
  const marker: BackgroundJob = {
    id: approvalArtifactId(
      "operation-consumption",
      input.approval.orgId,
      input.approval.id,
    ),
    orgId: input.approval.orgId,
    ...(input.approval.workspaceId === undefined
      ? {}
      : { workspaceId: input.approval.workspaceId }),
    type: "tool.operation.approval.consumption",
    status: "completed",
    payload: {
      schemaVersion: OPERATION_APPROVAL_CONSUMPTION_SCHEMA,
      approvalRequestId: input.approval.id,
      actorId: input.subject.id,
      requestDigest: input.requestDigest,
      consumedAt: now,
    },
    createdAt: now,
    updatedAt: now,
    completedAt: now,
  };
  try {
    await input.repository.createBackgroundJob(marker);
  } catch (error) {
    if (!isUniqueConstraintError(error) && !isInMemoryDuplicate(error))
      throw error;
    throw new ApiError(
      "tool_operation_approval_request_consumed",
      "Tool operation approval request was already consumed.",
      409,
      { approvalRequestId: input.approval.id },
    );
  }
}

function approvalConnectorScope(connector: ToolConnector): object {
  return {
    id: connector.id,
    orgId: connector.orgId,
    type: connector.type,
  };
}

function approvalOperationScope(operation: ToolOperation): object {
  return {
    id: operation.id,
    connectorId: operation.connectorId,
    operationId: operation.operationId,
    method: operation.method,
    path: operation.path,
    approvalPolicy: operation.approvalPolicy,
    riskLevel: operation.riskLevel,
  };
}

function approvalArtifactId(
  kind: string,
  orgId: string,
  approvalRequestId: string,
): string {
  const digest = createHash("sha256")
    .update(`romeo.tool-approval.${kind}.v1`)
    .update("\0")
    .update(orgId)
    .update("\0")
    .update(approvalRequestId)
    .digest("hex");
  return `job_tool_approval_${kind.replaceAll("-", "_")}_${digest.slice(0, 32)}`;
}

function isInMemoryDuplicate(error: unknown): boolean {
  return (
    error instanceof Error &&
    /^Background job .* already exists\.$/.test(error.message)
  );
}

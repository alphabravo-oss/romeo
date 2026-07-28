import { createHash } from "node:crypto";

import type {
  BackgroundJob,
  ToolConnector,
  ToolOperationDispatchPayloadStorage,
  ToolOperationDispatchPayloadStoreReference,
  ToolOperationDispatchRequestResult,
} from "../domain/entities";
import { ApiError } from "../errors";
import { completeBackgroundJob, startBackgroundJob } from "./job-service";
import { writeAuditLog } from "./audit-log";
import {
  type ToolDispatchPayload,
  type ToolDispatchPayloadAuth,
} from "./tool-dispatch-payload-store";
import {
  sameStringArray,
  sortedKeys,
  summarizeJob,
} from "./tool-operation-dispatch-execution";
import {
  apiKeyAuthPlacement,
  dispatchBaseHost,
  toolOperationDispatchTransport,
} from "./tool-operation-dispatch-request";
import type {
  DispatchToolOperationInput,
  EnqueueToolOperationDispatchInput,
} from "./tool-operation-dispatch-types";

export async function assertDispatchApproval(
  input: DispatchToolOperationInput,
  auditAction: string,
): Promise<void> {
  if (input.operation.approvalPolicy === "never") return;
  if (input.approved !== true) {
    const approvalRequest = await createDispatchApprovalRequest(input);
    const errorCode = "tool_operation_approval_required";
    await auditApprovalFailure(
      input,
      errorCode,
      auditAction,
      approvalRequest.id,
    );
    throw new ApiError(
      errorCode,
      "Tool operation dispatch requires approval before execution.",
      409,
      {
        approvalPolicy: input.operation.approvalPolicy,
        riskLevel: input.operation.riskLevel,
        approvalRequestId: approvalRequest.id,
      },
    );
  }
  if (input.approvalRequestId === undefined) {
    const errorCode = "tool_operation_approval_request_required";
    await auditApprovalFailure(input, errorCode, auditAction);
    throw new ApiError(
      errorCode,
      "Approved tool operation dispatch requires an approval request ID.",
      409,
      {
        approvalPolicy: input.operation.approvalPolicy,
        riskLevel: input.operation.riskLevel,
      },
    );
  }
  const approvalRequest = (
    await input.repository.listBackgroundJobs(input.subject.orgId)
  ).find((job) => job.id === input.approvalRequestId);
  const validationError = validateDispatchApprovalRequest(
    input,
    approvalRequest,
  );
  if (validationError !== undefined) {
    await auditApprovalFailure(
      input,
      validationError,
      auditAction,
      input.approvalRequestId,
    );
    throw new ApiError(
      validationError,
      "Tool operation approval request is invalid for this dispatch.",
      409,
      {
        approvalPolicy: input.operation.approvalPolicy,
        riskLevel: input.operation.riskLevel,
      },
    );
  }
  if (approvalRequest !== undefined)
    await consumeDispatchApprovalRequest(input, approvalRequest);
}

async function createDispatchApprovalRequest(
  input: DispatchToolOperationInput,
): Promise<BackgroundJob> {
  const job = await startBackgroundJob(input.repository, {
    orgId: input.subject.orgId,
    type: "tool.operation.approval_request",
    payload: {
      actorId: input.subject.id,
      connectorId: input.connector.id,
      operationId: input.operation.operationId,
      method: input.operation.method,
      path: input.operation.path,
      approvalPolicy: input.operation.approvalPolicy,
      riskLevel: input.operation.riskLevel,
      parameterKeys: sortedKeys(input.parameters),
      bodyKeys: sortedKeys(input.body),
    },
  });
  return completeBackgroundJob(input.repository, job);
}

function consumeDispatchApprovalRequest(
  input: DispatchToolOperationInput,
  approvalRequest: BackgroundJob,
): Promise<BackgroundJob> {
  const now = new Date().toISOString();
  return input.repository.updateBackgroundJob({
    ...approvalRequest,
    payload: {
      ...approvalRequest.payload,
      consumedAt: now,
      consumedBy: input.subject.id,
    },
    updatedAt: now,
  });
}

async function auditApprovalFailure(
  input: DispatchToolOperationInput,
  errorCode: string,
  action: string,
  approvalRequestId?: string,
): Promise<void> {
  await writeAuditLog(input.repository, {
    subject: input.subject,
    action,
    resourceType: "tool_operation",
    resourceId: input.operation.id,
    outcome: "failure",
    metadata: {
      connectorId: input.connector.id,
      operationId: input.operation.operationId,
      method: input.operation.method,
      path: input.operation.path,
      approvalPolicy: input.operation.approvalPolicy,
      riskLevel: input.operation.riskLevel,
      parameterKeys: sortedKeys(input.parameters),
      bodyKeys: sortedKeys(input.body),
      ...(approvalRequestId === undefined ? {} : { approvalRequestId }),
      errorCode,
    },
  });
}

export async function auditDispatchEnqueue(
  input: DispatchToolOperationInput,
  job: BackgroundJob,
  host: string,
  idempotency?: { keyHash: string; replayed: boolean },
): Promise<void> {
  await writeAuditLog(input.repository, {
    subject: input.subject,
    action: "tool.operation.dispatch.enqueue",
    resourceType: "tool_operation",
    resourceId: input.operation.id,
    metadata: {
      jobId: job.id,
      connectorId: input.connector.id,
      operationId: input.operation.operationId,
      method: input.operation.method,
      path: input.operation.path,
      workerQueue: "external_tool_operations",
      host,
      approvalPolicy: input.operation.approvalPolicy,
      riskLevel: input.operation.riskLevel,
      parameterKeys: sortedKeys(input.parameters),
      bodyKeys: sortedKeys(input.body),
      payloadStorage: jobPayloadStorage(job),
      ...(idempotency === undefined
        ? {}
        : {
            idempotencyKeyHash: idempotency.keyHash,
            idempotencyReplay: idempotency.replayed,
          }),
      ...(input.approvalRequestId === undefined
        ? {}
        : { approvalRequestId: input.approvalRequestId }),
    },
  });
}

export async function findIdempotentDispatchRequest(
  input: EnqueueToolOperationDispatchInput,
  keyHash: string,
): Promise<BackgroundJob | undefined> {
  const match = (
    await input.repository.listBackgroundJobs(input.subject.orgId)
  ).find(
    (job) =>
      job.type === "tool.operation.dispatch_request" &&
      job.payload.idempotencyKeyHash === keyHash,
  );
  if (match === undefined) return undefined;
  if (!sameDispatchRequestShape(input, match)) {
    throw new ApiError(
      "tool_operation_dispatch_idempotency_conflict",
      "Tool operation dispatch idempotency key was already used for a different request shape.",
      409,
      {
        jobId: match.id,
      },
    );
  }
  return match;
}

export function dispatchRequestResult(
  input: DispatchToolOperationInput,
  job: BackgroundJob,
  host: string,
  replayed: boolean | undefined,
): ToolOperationDispatchRequestResult {
  return {
    job: summarizeJob(job),
    connectorId: input.connector.id,
    operationId: input.operation.operationId,
    method: input.operation.method,
    pathTemplate: input.operation.path,
    workerQueue: "external_tool_operations",
    request: {
      parameterKeys: sortedKeys(input.parameters),
      bodyKeys: sortedKeys(input.body),
      host,
      payloadStorage: jobPayloadStorage(job),
    },
    approval: {
      required: input.operation.approvalPolicy !== "never",
      approvalPolicy: input.operation.approvalPolicy,
      riskLevel: input.operation.riskLevel,
      ...(typeof job.payload.approvalRequestId === "string"
        ? { approvalRequestId: job.payload.approvalRequestId }
        : {}),
    },
    ...(replayed === undefined ? {} : { idempotency: { replayed } }),
  };
}

export async function storeDispatchPayload(
  input: EnqueueToolOperationDispatchInput,
): Promise<ToolOperationDispatchPayloadStoreReference | undefined> {
  if (input.dispatchPayloadStore === undefined) return undefined;
  try {
    return await input.dispatchPayloadStore.store({
      actorId: input.subject.id,
      connectorId: input.connector.id,
      operationId: input.operation.operationId,
      orgId: input.subject.orgId,
      payload: buildToolDispatchPayload(input),
    });
  } catch {
    throw new ApiError(
      "tool_dispatch_payload_store_unavailable",
      "Tool dispatch payload storage is unavailable.",
      503,
    );
  }
}

export async function deleteStoredPayload(
  input: EnqueueToolOperationDispatchInput,
  reference: ToolOperationDispatchPayloadStoreReference | undefined,
): Promise<void> {
  if (input.dispatchPayloadStore === undefined || reference === undefined)
    return;
  try {
    await input.dispatchPayloadStore.delete(reference);
  } catch {
    // Terminal job state is authoritative; S3 lifecycle policy is the fallback.
  }
}

function buildToolDispatchPayload(
  input: EnqueueToolOperationDispatchInput,
): ToolDispatchPayload {
  const payload: ToolDispatchPayload = {};
  if (input.parameters !== undefined) payload.parameters = input.parameters;
  if (input.body !== undefined) payload.body = input.body;
  const auth = dispatchPayloadAuth(input.connector);
  if (auth !== undefined) payload.auth = auth;
  return payload;
}

function dispatchPayloadAuth(
  connector: ToolConnector,
): ToolDispatchPayloadAuth | undefined {
  const type =
    typeof connector.authConfig.type === "string"
      ? connector.authConfig.type
      : "none";
  if (type === "none") return undefined;
  const secretRef =
    typeof connector.authConfig.secretRef === "string"
      ? connector.authConfig.secretRef
      : undefined;
  if (secretRef === undefined) return undefined;
  if (type === "bearer") return { type, secretRef };
  if (type === "oauth2_client_credentials") return { type, secretRef };
  if (type === "api_key") {
    const placement = apiKeyAuthPlacement(connector);
    return {
      type,
      secretRef,
      apiKeyIn: placement.apiKeyIn,
      apiKeyName: placement.apiKeyName,
    };
  }
  return undefined;
}

export function dispatchPayloadStorage(
  reference: ToolOperationDispatchPayloadStoreReference | undefined,
): ToolOperationDispatchPayloadStorage {
  return reference === undefined
    ? "external_worker_secret_store_required"
    : "managed_encrypted_object_store";
}

function jobPayloadStorage(
  job: BackgroundJob,
): ToolOperationDispatchPayloadStorage {
  return job.payload.payloadStorage === "managed_encrypted_object_store"
    ? "managed_encrypted_object_store"
    : "external_worker_secret_store_required";
}

function sameDispatchRequestShape(
  input: EnqueueToolOperationDispatchInput,
  job: BackgroundJob,
): boolean {
  const payload = job.payload;
  return (
    payload.actorId === input.subject.id &&
    payload.connectorId === input.connector.id &&
    payload.operationId === input.operation.operationId &&
    payload.method === input.operation.method &&
    payload.path === input.operation.path &&
    payload.workerQueue === "external_tool_operations" &&
    payload.host === dispatchBaseHost(input.connector) &&
    payload.approvalPolicy === input.operation.approvalPolicy &&
    payload.riskLevel === input.operation.riskLevel &&
    payload.runId === (input.runContext?.runId ?? payload.runId) &&
    payload.toolId === (input.runContext?.toolId ?? payload.toolId) &&
    sameStringArray(payload.parameterKeys, sortedKeys(input.parameters)) &&
    sameStringArray(payload.bodyKeys, sortedKeys(input.body))
  );
}

export function dispatchRequestIdempotency(
  input: EnqueueToolOperationDispatchInput,
): { jobId: string; keyHash: string; scope: string } | undefined {
  if (input.idempotencyKey === undefined) return undefined;
  const scope = "tool.operation.dispatch_request.v1";
  const keyHash = createHash("sha256")
    .update(scope)
    .update("\0")
    .update(input.subject.orgId)
    .update("\0")
    .update(input.subject.id)
    .update("\0")
    .update(input.connector.id)
    .update("\0")
    .update(input.operation.operationId)
    .update("\0")
    .update(input.runContext?.runId ?? "")
    .update("\0")
    .update(input.runContext?.toolId ?? "")
    .update("\0")
    .update(input.idempotencyKey)
    .digest("hex");
  return {
    jobId: `job_dispatch_request_${keyHash.slice(0, 32)}`,
    keyHash,
    scope,
  };
}

function validateDispatchApprovalRequest(
  input: DispatchToolOperationInput,
  approvalRequest: BackgroundJob | undefined,
): string | undefined {
  if (
    approvalRequest === undefined ||
    approvalRequest.type !== "tool.operation.approval_request" ||
    approvalRequest.status !== "completed"
  ) {
    return "invalid_tool_operation_approval_request";
  }
  if (
    Date.now() - new Date(approvalRequest.createdAt).getTime() >
    15 * 60 * 1000
  )
    return "tool_operation_approval_request_expired";
  const payload = approvalRequest.payload;
  if (typeof payload.consumedAt === "string")
    return "invalid_tool_operation_approval_request";
  if (typeof payload.cancelledAt === "string")
    return "tool_operation_approval_request_cancelled";
  if (typeof payload.rejectedAt === "string")
    return "tool_operation_approval_request_rejected";
  if (
    payload.actorId !== input.subject.id ||
    payload.connectorId !== input.connector.id ||
    payload.operationId !== input.operation.operationId ||
    payload.method !== input.operation.method ||
    payload.path !== input.operation.path ||
    payload.approvalPolicy !== input.operation.approvalPolicy ||
    payload.riskLevel !== input.operation.riskLevel ||
    !sameStringArray(payload.parameterKeys, sortedKeys(input.parameters)) ||
    !sameStringArray(payload.bodyKeys, sortedKeys(input.body))
  ) {
    return "invalid_tool_operation_approval_request";
  }
  return undefined;
}

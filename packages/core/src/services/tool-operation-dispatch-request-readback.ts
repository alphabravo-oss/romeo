import type { AuthSubject } from "@romeo/auth";

import type {
  BackgroundJob,
  ToolOperationDispatchRequestExpiryReason,
  ToolOperationDispatchRequestExpiryResult,
  ToolOperationDispatchRequestPayloadResult,
  ToolOperationDispatchReadbackResponse,
  ToolOperationDispatchRequestReadbackResult,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { writeAuditLog } from "./audit-log";
import type { ToolDispatchPayload } from "./tool-dispatch-payload-store";
import {
  jobPayloadStorage,
  payloadString,
  payloadStringArray,
  readWorkerLease,
  validateDispatchRequestPayload,
} from "./tool-operation-dispatch-request-payload";
import {
  dispatchRequestType,
  workerQueue,
} from "./tool-operation-dispatch-request-types";

export async function findClaimedDispatchRequest(
  repository: RomeoRepository,
  subject: AuthSubject,
  jobId: string,
): Promise<BackgroundJob> {
  const job = (await repository.listBackgroundJobs(subject.orgId)).find(
    (item) => item.id === jobId,
  );
  if (job === undefined || job.type !== dispatchRequestType)
    throw notFound("Tool operation dispatch request");
  if (job.status !== "running") {
    throw new ApiError(
      "tool_operation_dispatch_request_not_claimed",
      "Tool operation dispatch request is not claimed by this worker.",
      409,
      {
        status: job.status,
      },
    );
  }
  validateDispatchRequestPayload(job);
  const lease = readWorkerLease(job);
  if (
    lease === undefined ||
    lease.workerId !== subject.id ||
    Date.parse(lease.expiresAt) <= Date.now()
  ) {
    throw new ApiError(
      "tool_operation_dispatch_request_lease_invalid",
      "Tool operation dispatch request lease is invalid or expired.",
      409,
    );
  }
  return job;
}

export async function findCancellableDispatchRequest(
  repository: RomeoRepository,
  subject: AuthSubject,
  jobId: string,
): Promise<BackgroundJob> {
  const job = (await repository.listBackgroundJobs(subject.orgId)).find(
    (item) => item.id === jobId,
  );
  if (job === undefined || job.type !== dispatchRequestType)
    throw notFound("Tool operation dispatch request");
  if (job.status === "completed" || job.status === "failed") {
    throw new ApiError(
      "tool_operation_dispatch_request_terminal",
      "Tool operation dispatch request is already terminal.",
      409,
      {
        status: job.status,
      },
    );
  }
  validateDispatchRequestPayload(job);
  return job;
}

export async function auditDispatchRequestReadback(
  repository: RomeoRepository,
  subject: AuthSubject,
  job: BackgroundJob,
  action: string,
  outcome: "failure" | "success",
  metadata: Record<string, unknown>,
): Promise<void> {
  await writeAuditLog(repository, {
    subject,
    action,
    resourceType: "tool_operation",
    resourceId: payloadString(job, "operationId"),
    outcome,
    metadata: {
      jobId: job.id,
      connectorId: payloadString(job, "connectorId"),
      operationId: payloadString(job, "operationId"),
      method: payloadString(job, "method"),
      path: payloadString(job, "path"),
      workerQueue,
      host: payloadString(job, "host"),
      parameterKeys: payloadStringArray(job, "parameterKeys"),
      bodyKeys: payloadStringArray(job, "bodyKeys"),
      payloadStorage: jobPayloadStorage(job),
      ...metadata,
    },
  });
}

export function readbackResult(
  job: BackgroundJob,
  outcome: "cancelled" | "completed" | "failed",
  result:
    | { errorCode: string }
    | { response: ToolOperationDispatchReadbackResponse },
): ToolOperationDispatchRequestReadbackResult {
  return {
    job: { id: job.id, type: job.type, status: job.status },
    connectorId: payloadString(job, "connectorId"),
    operationId: payloadString(job, "operationId"),
    method: payloadString(job, "method"),
    pathTemplate: payloadString(job, "path"),
    workerQueue,
    outcome,
    ...result,
  };
}

export function payloadResult(
  job: BackgroundJob,
  payload: ToolDispatchPayload,
): ToolOperationDispatchRequestPayloadResult {
  return {
    job: { id: job.id, type: job.type, status: job.status },
    connectorId: payloadString(job, "connectorId"),
    operationId: payloadString(job, "operationId"),
    method: payloadString(job, "method"),
    pathTemplate: payloadString(job, "path"),
    workerQueue,
    request: {
      parameterKeys: payloadStringArray(job, "parameterKeys"),
      bodyKeys: payloadStringArray(job, "bodyKeys"),
      host: payloadString(job, "host"),
      payloadStorage: jobPayloadStorage(job),
    },
    payload,
  };
}

export function expiryResult(
  job: BackgroundJob,
  reasonCode: ToolOperationDispatchRequestExpiryReason,
): ToolOperationDispatchRequestExpiryResult["jobs"][number] {
  return {
    job: { id: job.id, type: job.type, status: job.status },
    connectorId: payloadString(job, "connectorId"),
    operationId: payloadString(job, "operationId"),
    method: payloadString(job, "method"),
    pathTemplate: payloadString(job, "path"),
    reasonCode,
  };
}

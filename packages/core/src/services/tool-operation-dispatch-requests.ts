import { assertScope } from "@romeo/auth";

import type {
  ToolOperationDispatchPayloadStoreReference,
  ToolOperationDispatchRequestClaimResult,
  ToolOperationDispatchRequestPayloadResult,
  ToolOperationDispatchRequestExpiryResult,
  ToolOperationDispatchRequestReadbackResult,
} from "../domain/entities";
import { ApiError } from "../errors";
import { assertAbuseControlsAllow } from "./abuse-control-service";
import { continueTelemetryContextFromPayload } from "./telemetry-context";
import { claimResult } from "./tool-operation-dispatch-request-claim";
import {
  deadLetterDispatchRequest,
  dispatchRequestExpirationCandidate,
  expirationPayload,
} from "./tool-operation-dispatch-request-lifecycle";
import {
  assertPayloadMatchesClaim,
  deleteDispatchPayloadObject,
  jobPayloadStorage,
  jobPayloadStoreReference,
  readDispatchPayloadObject,
  readWorkerLease,
  validateDispatchRequestPayload,
} from "./tool-operation-dispatch-request-payload";
import {
  auditDispatchRequestReadback,
  expiryResult,
  findCancellableDispatchRequest,
  findClaimedDispatchRequest,
  payloadResult,
  readbackResult,
} from "./tool-operation-dispatch-request-readback";
import {
  dispatchRequestMaxAttempts,
  dispatchRequestType,
  workerQueue,
  type CancelToolOperationDispatchRequestInput,
  type ClaimToolOperationDispatchRequestInput,
  type CompleteToolOperationDispatchRequestInput,
  type ExpireToolOperationDispatchRequestsInput,
  type FailToolOperationDispatchRequestInput,
  type ReadToolOperationDispatchRequestPayloadInput,
  type RenewToolOperationDispatchRequestLeaseInput,
} from "./tool-operation-dispatch-request-types";

export * from "./tool-operation-dispatch-request-types";

export async function claimToolOperationDispatchRequest(
  input: ClaimToolOperationDispatchRequestInput,
): Promise<ToolOperationDispatchRequestClaimResult> {
  assertScope(input.subject, "tools:manage");
  await assertAbuseControlsAllow(input.repository, input.subject, {
    action: "worker.enqueue",
    workerClass: workerQueue,
  });
  const result = await input.repository.transaction(async (repository) => {
    const job = await repository.claimBackgroundJob({
      orgId: input.subject.orgId,
      type: dispatchRequestType,
      workerId: input.subject.id,
      leaseSeconds: input.leaseSeconds,
      ...(input.payloadStorage === undefined
        ? {}
        : { payloadEquals: { payloadStorage: input.payloadStorage } }),
    });
    if (job === undefined) return { result: { claimed: false, workerQueue } };
    continueTelemetryContextFromPayload(job.payload);
    validateDispatchRequestPayload(job);
    const lease = readWorkerLease(job);
    if (lease === undefined) {
      throw new ApiError(
        "tool_operation_dispatch_request_lease_invalid",
        "Tool operation dispatch request lease is invalid or expired.",
        409,
      );
    }
    if (lease.attempt > dispatchRequestMaxAttempts) {
      const deadLettered = await deadLetterDispatchRequest(
        repository,
        input.subject,
        job,
        lease,
      );
      return {
        payloadStoreReference: jobPayloadStoreReference(deadLettered),
        result: { claimed: false, workerQueue },
      };
    }
    return { result: await claimResult(repository, job) };
  });
  await deleteDispatchPayloadObject(
    input.dispatchPayloadStore,
    result.payloadStoreReference,
  );
  return result.result;
}

export async function readToolOperationDispatchRequestPayload(
  input: ReadToolOperationDispatchRequestPayloadInput,
): Promise<ToolOperationDispatchRequestPayloadResult> {
  assertScope(input.subject, "tools:manage");
  const job = await findClaimedDispatchRequest(
    input.repository,
    input.subject,
    input.jobId,
  );
  const reference = jobPayloadStoreReference(job);
  if (reference === undefined) {
    throw new ApiError(
      "tool_operation_dispatch_payload_not_managed",
      "Tool operation dispatch request does not use managed payload storage.",
      409,
      { payloadStorage: jobPayloadStorage(job) },
    );
  }
  if (input.dispatchPayloadStore === undefined) {
    throw new ApiError(
      "tool_operation_dispatch_payload_store_not_configured",
      "Tool operation dispatch payload storage is not configured.",
      409,
    );
  }
  const stored = await readDispatchPayloadObject(
    input.dispatchPayloadStore,
    reference,
  );
  assertPayloadMatchesClaim(job, stored);
  await auditDispatchRequestReadback(
    input.repository,
    input.subject,
    job,
    "tool.operation.dispatch_request.payload.read",
    "success",
    { payloadStoreDriver: reference.driver },
  );
  return payloadResult(job, stored.payload);
}

export async function renewToolOperationDispatchRequestLease(
  input: RenewToolOperationDispatchRequestLeaseInput,
): Promise<ToolOperationDispatchRequestClaimResult> {
  assertScope(input.subject, "tools:manage");
  const job = await input.repository.renewBackgroundJobLease({
    orgId: input.subject.orgId,
    jobId: input.jobId,
    workerId: input.subject.id,
    leaseSeconds: input.leaseSeconds,
  });
  if (job === undefined) {
    throw new ApiError(
      "tool_operation_dispatch_request_lease_invalid",
      "Tool operation dispatch request lease is invalid or expired.",
      409,
    );
  }
  validateDispatchRequestPayload(job);
  return claimResult(input.repository, job);
}

export async function completeToolOperationDispatchRequest(
  input: CompleteToolOperationDispatchRequestInput,
): Promise<ToolOperationDispatchRequestReadbackResult> {
  assertScope(input.subject, "tools:manage");
  const result = await input.repository.transaction(async (repository) => {
    const job = await findClaimedDispatchRequest(
      repository,
      input.subject,
      input.jobId,
    );
    const now = new Date().toISOString();
    const completed = await repository.updateBackgroundJob({
      ...job,
      status: "completed",
      payload: {
        ...job.payload,
        workerCompletedAt: now,
        workerId: input.subject.id,
        workerResult: input.response,
      },
      updatedAt: now,
      completedAt: now,
    });
    await auditDispatchRequestReadback(
      repository,
      input.subject,
      completed,
      "tool.operation.dispatch_request.complete",
      "success",
      {
        responseStatus: input.response.status,
        responseOk: input.response.ok,
        responseBodyBytes: input.response.bodyBytes,
        responseTruncated: input.response.truncated,
        responseSchemaValidation: input.response.schemaValidation,
      },
    );
    return {
      payloadStoreReference: jobPayloadStoreReference(completed),
      result: readbackResult(completed, "completed", {
        response: input.response,
      }),
    };
  });
  await deleteDispatchPayloadObject(
    input.dispatchPayloadStore,
    result.payloadStoreReference,
  );
  return result.result;
}

export async function failToolOperationDispatchRequest(
  input: FailToolOperationDispatchRequestInput,
): Promise<ToolOperationDispatchRequestReadbackResult> {
  assertScope(input.subject, "tools:manage");
  const result = await input.repository.transaction(async (repository) => {
    const job = await findClaimedDispatchRequest(
      repository,
      input.subject,
      input.jobId,
    );
    const now = new Date().toISOString();
    const failed = await repository.updateBackgroundJob({
      ...job,
      status: "failed",
      payload: {
        ...job.payload,
        errorCode: input.errorCode,
        workerFailedAt: now,
        workerId: input.subject.id,
      },
      updatedAt: now,
      completedAt: now,
    });
    await auditDispatchRequestReadback(
      repository,
      input.subject,
      failed,
      "tool.operation.dispatch_request.fail",
      "failure",
      {
        errorCode: input.errorCode,
      },
    );
    return {
      payloadStoreReference: jobPayloadStoreReference(failed),
      result: readbackResult(failed, "failed", {
        errorCode: input.errorCode,
      }),
    };
  });
  await deleteDispatchPayloadObject(
    input.dispatchPayloadStore,
    result.payloadStoreReference,
  );
  return result.result;
}

export async function cancelToolOperationDispatchRequest(
  input: CancelToolOperationDispatchRequestInput,
): Promise<ToolOperationDispatchRequestReadbackResult> {
  assertScope(input.subject, "tools:manage");
  const result = await input.repository.transaction(async (repository) => {
    const job = await findCancellableDispatchRequest(
      repository,
      input.subject,
      input.jobId,
    );
    const now = new Date().toISOString();
    const reasonCode = input.reasonCode ?? "operator_cancelled";
    const cancelled = await repository.updateBackgroundJob({
      ...job,
      status: "failed",
      payload: {
        ...job.payload,
        cancelledAt: now,
        cancelledBy: input.subject.id,
        cancelReasonCode: reasonCode,
        errorCode: "worker_cancelled",
      },
      updatedAt: now,
      completedAt: now,
    });
    await auditDispatchRequestReadback(
      repository,
      input.subject,
      cancelled,
      "tool.operation.dispatch_request.cancel",
      "success",
      {
        errorCode: "worker_cancelled",
        reasonCode,
      },
    );
    return {
      payloadStoreReference: jobPayloadStoreReference(cancelled),
      result: readbackResult(cancelled, "cancelled", {
        errorCode: "worker_cancelled",
      }),
    };
  });
  await deleteDispatchPayloadObject(
    input.dispatchPayloadStore,
    result.payloadStoreReference,
  );
  return result.result;
}

export async function expireToolOperationDispatchRequests(
  input: ExpireToolOperationDispatchRequestsInput,
): Promise<ToolOperationDispatchRequestExpiryResult> {
  assertScope(input.subject, "tools:manage");
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const result = await input.repository.transaction(async (repository) => {
    const candidates = (
      await repository.listBackgroundJobs(input.subject.orgId)
    )
      .map((job) => dispatchRequestExpirationCandidate(job, input, nowMs))
      .filter((candidate) => candidate !== undefined)
      .sort(
        (left, right) =>
          left.referenceTimeMs - right.referenceTimeMs ||
          left.job.id.localeCompare(right.job.id),
      )
      .slice(0, input.limit);

    const expiredJobs: ToolOperationDispatchRequestExpiryResult["jobs"] = [];
    const payloadStoreReferences: ToolOperationDispatchPayloadStoreReference[] =
      [];
    for (const candidate of candidates) {
      validateDispatchRequestPayload(candidate.job);
      const expiration = expirationPayload(input, candidate, now);
      const expired = await repository.updateBackgroundJob({
        ...candidate.job,
        status: "failed",
        payload: {
          ...candidate.job.payload,
          errorCode: "worker_dispatch_request_expired",
          expiredAt: now,
          expiredBy: input.subject.id,
          expiration,
        },
        updatedAt: now,
        completedAt: now,
      });
      await auditDispatchRequestReadback(
        repository,
        input.subject,
        expired,
        "tool.operation.dispatch_request.expire",
        "failure",
        {
          errorCode: "worker_dispatch_request_expired",
          ...expiration,
        },
      );
      expiredJobs.push(expiryResult(expired, candidate.reasonCode));
      const reference = jobPayloadStoreReference(expired);
      if (reference !== undefined) payloadStoreReferences.push(reference);
    }

    return {
      payloadStoreReferences,
      result: { expired: expiredJobs.length, workerQueue, jobs: expiredJobs },
    };
  });
  await Promise.all(
    result.payloadStoreReferences.map((reference) =>
      deleteDispatchPayloadObject(input.dispatchPayloadStore, reference),
    ),
  );
  return result.result;
}

import type { AuthSubject } from "@romeo/auth";

import type {
  BackgroundJob,
  ToolOperationDispatchRequestExpiryReason,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { readWorkerLease } from "./tool-operation-dispatch-request-payload";
import { auditDispatchRequestReadback } from "./tool-operation-dispatch-request-readback";
import {
  dispatchRequestMaxAttempts,
  dispatchRequestType,
  type ExpireToolOperationDispatchRequestsInput,
} from "./tool-operation-dispatch-request-types";

export async function deadLetterDispatchRequest(
  repository: RomeoRepository,
  subject: AuthSubject,
  job: BackgroundJob,
  lease: {
    attempt: number;
    claimedAt: string;
    expiresAt: string;
    leaseSeconds: number;
    renewedAt: string;
    workerId: string;
  },
): Promise<BackgroundJob> {
  const now = new Date().toISOString();
  const deadLettered = await repository.updateBackgroundJob({
    ...job,
    status: "failed",
    payload: {
      ...job.payload,
      deadLetter: {
        attempts: dispatchRequestMaxAttempts,
        failedAt: now,
        maxAttempts: dispatchRequestMaxAttempts,
        nextAttempt: lease.attempt,
        reasonCode: "max_attempts_exhausted",
        workerId: subject.id,
      },
      errorCode: "worker_attempts_exhausted",
      workerFailedAt: now,
      workerId: subject.id,
    },
    updatedAt: now,
    completedAt: now,
  });
  await auditDispatchRequestReadback(
    repository,
    subject,
    deadLettered,
    "tool.operation.dispatch_request.dead_letter",
    "failure",
    {
      attempts: dispatchRequestMaxAttempts,
      errorCode: "worker_attempts_exhausted",
      maxAttempts: dispatchRequestMaxAttempts,
      nextAttempt: lease.attempt,
      reasonCode: "max_attempts_exhausted",
    },
  );
  return deadLettered;
}

export interface DispatchRequestExpirationCandidate {
  ageSeconds: number;
  job: BackgroundJob;
  leaseExpiredSeconds?: number;
  reasonCode: ToolOperationDispatchRequestExpiryReason;
  referenceTimeMs: number;
  workerId?: string;
}

export function dispatchRequestExpirationCandidate(
  job: BackgroundJob,
  input: ExpireToolOperationDispatchRequestsInput,
  nowMs: number,
): DispatchRequestExpirationCandidate | undefined {
  if (job.type !== dispatchRequestType) return undefined;
  if (job.status === "completed" || job.status === "failed") return undefined;

  if (job.status === "queued") {
    const createdAtMs = Date.parse(job.createdAt);
    if (!Number.isFinite(createdAtMs)) return undefined;
    const ageSeconds = Math.floor((nowMs - createdAtMs) / 1000);
    if (ageSeconds < input.queuedTimeoutSeconds) return undefined;
    return {
      ageSeconds,
      job,
      reasonCode: "queued_timeout",
      referenceTimeMs: createdAtMs,
    };
  }

  const lease = readWorkerLease(job);
  if (lease === undefined) return undefined;
  const leaseExpiresAtMs = Date.parse(lease.expiresAt);
  if (!Number.isFinite(leaseExpiresAtMs)) return undefined;
  const leaseExpiredSeconds = Math.floor((nowMs - leaseExpiresAtMs) / 1000);
  if (leaseExpiredSeconds < input.runningTimeoutSeconds) return undefined;
  const createdAtMs = Date.parse(job.createdAt);
  return {
    ageSeconds: Number.isFinite(createdAtMs)
      ? Math.floor((nowMs - createdAtMs) / 1000)
      : 0,
    job,
    leaseExpiredSeconds,
    reasonCode: "running_lease_timeout",
    referenceTimeMs: leaseExpiresAtMs,
    workerId: lease.workerId,
  };
}

export function expirationPayload(
  input: ExpireToolOperationDispatchRequestsInput,
  candidate: DispatchRequestExpirationCandidate,
  expiredAt: string,
): Record<string, unknown> {
  return {
    ageSeconds: candidate.ageSeconds,
    expiredAt,
    expiredBy: input.subject.id,
    reasonCode: candidate.reasonCode,
    ...(candidate.reasonCode === "queued_timeout"
      ? { queuedTimeoutSeconds: input.queuedTimeoutSeconds }
      : {}),
    ...(candidate.reasonCode === "running_lease_timeout"
      ? { runningTimeoutSeconds: input.runningTimeoutSeconds }
      : {}),
    ...(candidate.leaseExpiredSeconds === undefined
      ? {}
      : { leaseExpiredSeconds: candidate.leaseExpiredSeconds }),
    ...(candidate.workerId === undefined
      ? {}
      : { workerId: candidate.workerId }),
  };
}

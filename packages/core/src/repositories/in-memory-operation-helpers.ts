import type * as E from "../domain/entities";
import type * as R from "../domain/repository";

export function compareWebhookDeliveries(
  left: E.WebhookDelivery,
  right: E.WebhookDelivery,
): number {
  return left.createdAt === right.createdAt
    ? left.id.localeCompare(right.id)
    : right.createdAt.localeCompare(left.createdAt);
}

export function payloadEquals(
  payload: Record<string, unknown>,
  expected: Record<string, string> | undefined,
): boolean {
  if (expected === undefined) return true;
  return Object.entries(expected).every(
    ([key, value]) => payload[key] === value,
  );
}

export interface WorkerLeasePayload {
  attempt: number;
  claimedAt: string;
  expiresAt: string;
  leaseSeconds: number;
  renewedAt: string;
  workerId: string;
}

export function applyWorkerLease(
  job: E.BackgroundJob,
  input: R.ClaimBackgroundJobInput,
  now: string,
): E.BackgroundJob {
  const previousLease = readWorkerLease(job.payload);
  return {
    ...job,
    status: "running",
    payload: {
      ...job.payload,
      workerLease: {
        attempt: (previousLease?.attempt ?? 0) + 1,
        claimedAt: now,
        expiresAt: leaseExpiresAt(now, input.leaseSeconds),
        leaseSeconds: input.leaseSeconds,
        renewedAt: now,
        workerId: input.workerId,
      },
    },
    updatedAt: now,
  };
}

export function renewWorkerLease(
  job: E.BackgroundJob,
  input: R.RenewBackgroundJobLeaseInput,
  now: string,
  lease: WorkerLeasePayload,
): E.BackgroundJob {
  return {
    ...job,
    payload: {
      ...job.payload,
      workerLease: {
        ...lease,
        expiresAt: leaseExpiresAt(now, input.leaseSeconds),
        leaseSeconds: input.leaseSeconds,
        renewedAt: now,
      },
    },
    updatedAt: now,
  };
}

export function readWorkerLease(
  payload: Record<string, unknown>,
): WorkerLeasePayload | undefined {
  const value = payload.workerLease;
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const lease = value as Partial<WorkerLeasePayload>;
  if (
    typeof lease.workerId !== "string" ||
    typeof lease.claimedAt !== "string" ||
    typeof lease.renewedAt !== "string" ||
    typeof lease.expiresAt !== "string" ||
    typeof lease.leaseSeconds !== "number" ||
    typeof lease.attempt !== "number"
  )
    return undefined;
  return {
    attempt: lease.attempt,
    claimedAt: lease.claimedAt,
    expiresAt: lease.expiresAt,
    leaseSeconds: lease.leaseSeconds,
    renewedAt: lease.renewedAt,
    workerId: lease.workerId,
  };
}

function leaseExpiresAt(now: string, leaseSeconds: number): string {
  return new Date(
    Date.parse(now) + Math.max(1, leaseSeconds) * 1000,
  ).toISOString();
}

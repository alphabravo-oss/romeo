import { assertScope, type AuthSubject } from "@romeo/auth";
import { randomBytes } from "node:crypto";

import {
  AUDIT_EXPORT_PAYLOAD_SCHEMA,
  canonicalJson,
  sha256,
  type AuditExportAttempt,
  type AuditExportDestination,
  type AuditExportDestinationKind,
  type AuditExportJob,
  type AuditIntegrityCheckpoint,
  type AuditIntegrityRecord,
} from "../domain/audit-integrity";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";

export interface AuditExportDelivery {
  acknowledgementHash: string;
  destinationRangeEnd: string;
  destinationRangeStart: string;
}

export interface AuditExportReadback extends AuditExportDelivery {
  checkpointHash: string;
  payloadHash: string;
  retentionLockEvidence?: string;
}

export interface AuditExportClient {
  deliver(input: {
    destination: AuditExportDestination;
    job: AuditExportJob;
    payload: string;
    signal: AbortSignal;
  }): Promise<AuditExportDelivery>;
  readback(input: {
    acknowledgementHash: string;
    destination: AuditExportDestination;
    job: AuditExportJob;
    signal: AbortSignal;
  }): Promise<AuditExportReadback>;
}

export interface AuditExportWorkflowOptions {
  exportAttemptTimeoutMs?: number;
  exportLeaseSeconds?: number;
  exportMaxAttempts?: number;
}

export interface AuditDestinationPosture {
  ageMs?: number;
  lagSequences: number;
  lastSuccessAt?: string;
  state:
    | "dead_letter"
    | "not_configured"
    | "pending"
    | "retrying"
    | "running"
    | "verified";
}

export class AuditExportWorkflow {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly verifyCheckpoint: (
      checkpoint: AuditIntegrityCheckpoint,
    ) => Promise<{ outcome: "accepted" | "denied" }>,
    private readonly client?: AuditExportClient,
    private readonly options: AuditExportWorkflowOptions = {},
  ) {}

  async checkpoint(input: {
    checkpointHash?: string;
    destination: AuditExportDestinationKind;
    idempotencyKey: string;
    subject: AuthSubject;
  }) {
    assertScope(input.subject, "admin:write");
    const checkpoint = input.checkpointHash
      ? await this.repository.getAuditIntegrityCheckpointByHash(
          input.subject.orgId,
          input.checkpointHash,
        )
      : (
          await this.repository.listAuditIntegrityCheckpoints(
            input.subject.orgId,
          )
        ).at(-1);
    if (checkpoint === undefined) throw notFound("Audit checkpoint");
    const idempotencyKeyHash = sha256(input.idempotencyKey);
    const requestHash = sha256(
      canonicalJson({
        checkpointHash: checkpoint.checkpointHash,
        destination: input.destination,
        orgId: input.subject.orgId,
      }),
    );
    const receipt = await this.repository.getAuditExportIdempotencyReceipt(
      input.subject.orgId,
      idempotencyKeyHash,
    );
    if (receipt !== undefined) {
      if (receipt.requestHash !== requestHash)
        throw new ApiError(
          "idempotency_key_conflict",
          "The audit export idempotency key was already used for a different request.",
          409,
        );
      const existing = await this.repository.getAuditExportJob(
        input.subject.orgId,
        receipt.jobId,
      );
      if (existing === undefined)
        throw new Error("audit_export_receipt_orphaned");
      return response(existing, input.destination, checkpoint.createdAt, true);
    }
    const now = new Date().toISOString();
    const destination = await this.repository.upsertAuditExportDestination({
      active: true,
      configReference: `managed://audit-export/${input.destination}`,
      createdAt: now,
      id: `audit_destination_${sha256(`${input.subject.orgId}\0${input.destination}`).slice(0, 24)}`,
      kind: input.destination,
      orgId: input.subject.orgId,
      requireReadback: true,
      requireRetentionLock: input.destination === "worm_compatible",
      updatedAt: now,
    });
    if ((await this.verifyCheckpoint(checkpoint)).outcome !== "accepted")
      throw new Error("audit_checkpoint_invalid");
    const payload = exportPayload(
      checkpoint,
      await this.checkpointRecords(checkpoint),
    );
    const job: AuditExportJob = {
      attemptCount: 0,
      checkpointHash: checkpoint.checkpointHash,
      checkpointId: checkpoint.id,
      createdAt: now,
      destinationId: destination.id,
      fromSequence: checkpoint.fromSequence,
      id: createId("audit_export_job"),
      idempotencyKeyHash,
      maxAttempts: Math.min(
        Math.max(this.options.exportMaxAttempts ?? 5, 1),
        20,
      ),
      orgId: input.subject.orgId,
      payloadHash: sha256(payload),
      status: "queued",
      toSequence: checkpoint.toSequence,
      updatedAt: now,
    };
    await this.repository.transaction(async (repository) => {
      await repository.createAuditExportJob(job);
      await repository.createAuditExportIdempotencyReceipt({
        createdAt: now,
        id: createId("audit_export_receipt"),
        idempotencyKeyHash,
        jobId: job.id,
        orgId: job.orgId,
        requestHash,
      });
    });
    const processed =
      this.client === undefined
        ? job
        : await this.process({ jobId: job.id, orgId: job.orgId });
    return response(
      processed ?? job,
      input.destination,
      checkpoint.createdAt,
      false,
    );
  }

  async process(input: { jobId: string; orgId: string }) {
    if (this.client === undefined) return undefined;
    const now = new Date().toISOString();
    const leaseToken = randomBytes(24).toString("base64url");
    const claimed = await this.repository.claimAuditExportJob({
      jobId: input.jobId,
      leaseSeconds: Math.max(this.options.exportLeaseSeconds ?? 60, 1),
      leaseToken,
      now,
      orgId: input.orgId,
    });
    if (claimed === undefined) return undefined;
    const attemptNumber = claimed.attemptCount + 1;
    try {
      const destination = await this.destinationForJob(claimed);
      const checkpoint = await this.repository.getAuditIntegrityCheckpoint(
        claimed.orgId,
        claimed.checkpointId,
      );
      if (checkpoint === undefined) throw failure("checkpoint_missing");
      if ((await this.verifyCheckpoint(checkpoint)).outcome !== "accepted")
        throw failure("checkpoint_verification_failed");
      const payload = exportPayload(
        checkpoint,
        await this.checkpointRecords(checkpoint),
      );
      if (sha256(payload) !== claimed.payloadHash)
        throw failure("payload_digest_mismatch");
      const delivery = await withTimeout(
        (signal) =>
          this.client!.deliver({ destination, job: claimed, payload, signal }),
        this.options.exportAttemptTimeoutMs ?? 15_000,
      );
      validateRange(delivery, claimed);
      if (!/^[a-f\d]{64}$/u.test(delivery.acknowledgementHash))
        throw failure("acknowledgement_missing");
      const readback = await withTimeout(
        (signal) =>
          this.client!.readback({
            acknowledgementHash: delivery.acknowledgementHash,
            destination,
            job: claimed,
            signal,
          }),
        this.options.exportAttemptTimeoutMs ?? 15_000,
      );
      validateRange(readback, claimed);
      if (
        readback.acknowledgementHash !== delivery.acknowledgementHash ||
        readback.checkpointHash !== claimed.checkpointHash ||
        readback.payloadHash !== claimed.payloadHash
      )
        throw failure("readback_mismatch");
      if (
        destination.requireRetentionLock &&
        !readback.retentionLockEvidence?.trim()
      )
        throw failure("retention_lock_missing");
      return this.completeSuccess(
        claimed,
        attemptNumber,
        now,
        leaseToken,
        delivery,
        readback,
      );
    } catch (error) {
      return this.completeFailure(
        claimed,
        attemptNumber,
        now,
        leaseToken,
        errorCode(error),
      );
    }
  }

  async posture(subject: AuthSubject) {
    assertScope(subject, "admin:read");
    const [records, checkpoints] = await Promise.all([
      this.repository.listAuditIntegrityRecords(subject.orgId),
      this.repository.listAuditIntegrityCheckpoints(subject.orgId),
    ]);
    const latestSequence = Math.max(
      records.at(-1)?.sequence ?? 0,
      checkpoints.at(-1)?.toSequence ?? 0,
    );
    const read = async (
      kind: AuditExportDestinationKind,
    ): Promise<AuditDestinationPosture> => {
      const destination = await this.repository.getAuditExportDestination(
        subject.orgId,
        kind,
      );
      if (destination === undefined)
        return { lagSequences: latestSequence, state: "not_configured" };
      const jobs = await this.repository.listAuditExportJobs(
        subject.orgId,
        destination.id,
      );
      const latest = jobs.at(-1);
      const verified = jobs
        .filter((job) => job.status === "exported")
        .sort((left, right) => left.toSequence - right.toSequence)
        .at(-1);
      return {
        lagSequences: Math.max(0, latestSequence - (verified?.toSequence ?? 0)),
        state: postureState(latest, verified, latestSequence),
        ...(verified?.completedAt === undefined
          ? {}
          : {
              ageMs: Math.max(0, Date.now() - Date.parse(verified.completedAt)),
              lastSuccessAt: verified.completedAt,
            }),
      };
    };
    return {
      customerSiem: await read("customer_siem"),
      wormCompatible: await read("worm_compatible"),
    };
  }

  private async completeSuccess(
    job: AuditExportJob,
    attemptNumber: number,
    startedAt: string,
    leaseToken: string,
    delivery: AuditExportDelivery,
    readback: AuditExportReadback,
  ) {
    const completedAt = new Date().toISOString();
    const attempt: AuditExportAttempt = {
      acknowledgementHash: delivery.acknowledgementHash,
      attempt: attemptNumber,
      completedAt,
      destinationRangeEnd: readback.destinationRangeEnd,
      destinationRangeStart: readback.destinationRangeStart,
      id: createId("audit_export_attempt"),
      jobId: job.id,
      orgId: job.orgId,
      readbackHash: readback.payloadHash,
      startedAt,
      status: "verified",
      ...(readback.retentionLockEvidence === undefined
        ? {}
        : { retentionLockEvidence: readback.retentionLockEvidence }),
    };
    return this.repository.completeAuditExportAttempt({
      attempt,
      job: {
        ...withoutLease(job),
        acknowledgementHash: delivery.acknowledgementHash,
        attemptCount: attemptNumber,
        completedAt,
        destinationRangeEnd: readback.destinationRangeEnd,
        destinationRangeStart: readback.destinationRangeStart,
        readbackHash: readback.payloadHash,
        status: "exported",
        updatedAt: completedAt,
        ...(readback.retentionLockEvidence === undefined
          ? {}
          : { retentionLockEvidence: readback.retentionLockEvidence }),
      },
      leaseToken,
    });
  }

  private completeFailure(
    job: AuditExportJob,
    attemptNumber: number,
    startedAt: string,
    leaseToken: string,
    code: string,
  ) {
    const completedAt = new Date().toISOString();
    const deadLetter = attemptNumber >= job.maxAttempts;
    return this.repository.completeAuditExportAttempt({
      attempt: {
        attempt: attemptNumber,
        completedAt,
        errorCode: code,
        id: createId("audit_export_attempt"),
        jobId: job.id,
        orgId: job.orgId,
        startedAt,
        status: "failed",
      },
      job: {
        ...withoutLease(job),
        attemptCount: attemptNumber,
        lastErrorCode: code,
        status: deadLetter ? "dead_letter" : "retry_scheduled",
        updatedAt: completedAt,
        ...(deadLetter
          ? { deadLetterReason: code }
          : { nextAttemptAt: retryAt(completedAt, attemptNumber) }),
      },
      leaseToken,
    });
  }

  private async checkpointRecords(checkpoint: AuditIntegrityCheckpoint) {
    return (
      await this.repository.listAuditIntegrityRecords(checkpoint.orgId)
    ).filter(
      (record) =>
        record.sequence >= checkpoint.fromSequence &&
        record.sequence <= checkpoint.toSequence,
    );
  }

  private async destinationForJob(job: AuditExportJob) {
    for (const kind of ["customer_siem", "worm_compatible"] as const) {
      const destination = await this.repository.getAuditExportDestination(
        job.orgId,
        kind,
      );
      if (destination?.id === job.destinationId) return destination;
    }
    throw failure("destination_missing");
  }
}

function exportPayload(
  checkpoint: AuditIntegrityCheckpoint,
  records: readonly AuditIntegrityRecord[],
) {
  return canonicalJson({
    checkpoint,
    records,
    schema: AUDIT_EXPORT_PAYLOAD_SCHEMA,
  });
}

function validateRange(value: AuditExportDelivery, job: AuditExportJob) {
  if (
    value.destinationRangeStart !== String(job.fromSequence) ||
    value.destinationRangeEnd !== String(job.toSequence)
  )
    throw failure("destination_range_mismatch");
}

function retryAt(now: string, attempt: number) {
  return new Date(
    Date.parse(now) + Math.min(300_000, 1_000 * 2 ** Math.min(attempt - 1, 8)),
  ).toISOString();
}

function withoutLease(job: AuditExportJob): AuditExportJob {
  const { leaseExpiresAt: _expiry, leaseToken: _token, ...rest } = job;
  return rest;
}

function failure(code: string) {
  const error = new Error(code);
  error.name = "AuditExportFailure";
  return error;
}

function errorCode(error: unknown) {
  if (error instanceof Error && error.name === "AuditExportFailure")
    return error.message.slice(0, 80);
  if (error instanceof DOMException && error.name === "TimeoutError")
    return "destination_timeout";
  return "destination_delivery_failed";
}

async function withTimeout<T>(
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
) {
  const signal = AbortSignal.timeout(Math.max(1, timeoutMs));
  return Promise.race([
    work(signal),
    new Promise<T>((_resolve, reject) =>
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      }),
    ),
  ]);
}

function postureState(
  latest: AuditExportJob | undefined,
  verified: AuditExportJob | undefined,
  latestSequence: number,
): AuditDestinationPosture["state"] {
  if (latest?.status === "dead_letter") return "dead_letter";
  if (latest?.status === "retry_scheduled") return "retrying";
  if (latest?.status === "running") return "running";
  return verified?.toSequence === latestSequence ? "verified" : "pending";
}

function response(
  job: AuditExportJob,
  destination: AuditExportDestinationKind,
  checkpointCreatedAt: string,
  duplicate: boolean,
) {
  return {
    destination,
    duplicate,
    jobId: job.id,
    lagMs: Math.max(0, Date.now() - Date.parse(checkpointCreatedAt)),
    state:
      job.status === "exported"
        ? ("exported" as const)
        : job.status === "dead_letter"
          ? ("dead_letter" as const)
          : job.status === "retry_scheduled"
            ? ("failed" as const)
            : ("pending" as const),
  };
}

import { ObjectSizeLimitError, type ObjectStore } from "@romeo/storage";

import type { FileObject } from "../domain/entities";
import { tombstoneFileObject } from "../domain/file-tombstone";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { createId } from "../ids";
import { extractionAttempts, isExtractableMimeType } from "./file-object-state";
import type { FilePipelineSupport } from "./file-pipeline-support";
import { deleteFileObjectStoredObjects } from "./file-resumable-helpers";
import {
  fileLifecycleMaxAttempts,
  fileLifecycleRetryDelayMs,
  safeFileLifecycleFailureCode,
  transitionFileLifecycle,
} from "./file-lifecycle";
import { publishFileLifecycleWorkerMetric } from "./file-lifecycle-telemetry";
import type { FileServiceLimits } from "./file-service-contracts";

export interface FileLifecycleWorkerResult {
  fileId?: string;
  outcome: "completed" | "failed" | "idle" | "lease_lost" | "rejected";
  state?: FileObject["status"];
}

export class FileLifecycleWorker {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly objectStore: ObjectStore,
    private readonly pipeline: FilePipelineSupport,
    private readonly limits: FileServiceLimits,
  ) {}

  async runOnce(input: {
    workerId: string;
    leaseMs?: number;
    now?: string;
    signal?: AbortSignal;
  }): Promise<FileLifecycleWorkerResult> {
    if (input.signal?.aborted === true) return { outcome: "idle" };
    const now = input.now ?? new Date().toISOString();
    const leaseMs = Math.max(
      1_000,
      Math.min(input.leaseMs ?? 300_000, 900_000),
    );
    const leaseToken = createId("file_lease");
    const claimed = await this.repository.claimNextFileLifecycle({
      leaseOwner: input.workerId,
      leaseToken,
      now,
      leaseExpiresAt: new Date(Date.parse(now) + leaseMs).toISOString(),
    });
    if (claimed === undefined) return { outcome: "idle" };
    const clock =
      input.now === undefined ? () => new Date().toISOString() : () => now;
    const startedAt = Date.now();
    const result = await this.processClaimed(
      claimed,
      input.workerId,
      leaseToken,
      clock,
      leaseMs,
      input.signal,
    );
    publishFileLifecycleWorkerMetric({
      attempt: claimed.lifecycleAttempts ?? 0,
      durationMs: Math.max(0, Date.now() - startedAt),
      outcome: result.outcome,
      queueAgeSeconds: Math.max(
        0,
        Math.floor((Date.parse(now) - Date.parse(claimed.createdAt)) / 1_000),
      ),
      state: result.state ?? claimed.status,
    });
    return result;
  }

  private async processClaimed(
    claimed: FileObject,
    leaseOwner: string,
    leaseToken: string,
    clock: () => string,
    leaseMs: number,
    signal?: AbortSignal,
  ): Promise<FileLifecycleWorkerResult> {
    let current = claimed;
    try {
      const now = clock();
      const bytes = await bounded(
        (operationSignal) =>
          this.objectStore.getObject(current.objectKey, {
            maxBytes: Math.min(
              current.sizeBytes,
              configuredUploadLimit(current, this.limits),
            ),
            signal: operationSignal,
          }),
        leaseMs,
        signal,
      );
      if (bytes === undefined)
        throw new ApiError(
          "file_object_missing",
          "The stored file object was not found.",
          409,
        );
      if (current.status === "quarantined") {
        const scanning = transitionFileLifecycle(current, "scanning", now);
        const advanced = await this.repository.advanceFileLifecycleLease({
          file: scanning,
          leaseOwner,
          leaseToken,
          now,
        });
        if (advanced === undefined) return leaseLost(current);
        current = advanced;
      }
      if (current.status === "scanning") {
        const renewed = await this.renew(
          current,
          leaseOwner,
          leaseToken,
          clock(),
          leaseMs,
        );
        if (renewed === undefined) return leaseLost(current);
        current = renewed;
        await bounded(
          (operationSignal) =>
            this.pipeline.assertMalwareScanClean(
              bytes,
              current.fileName,
              current.mimeType,
              operationSignal,
            ),
          leaseMs,
          signal,
        );
        if (!isExtractableMimeType(current.mimeType)) {
          return this.finishReady(current, {}, leaseOwner, leaseToken, clock());
        }
        const extracting = transitionFileLifecycle(
          current,
          "extracting",
          clock(),
        );
        const advanced = await this.repository.advanceFileLifecycleLease({
          file: extracting,
          leaseOwner,
          leaseToken,
          now: clock(),
        });
        if (advanced === undefined) return leaseLost(current);
        current = advanced;
      }
      if (current.status === "extracting") {
        const renewed = await this.renew(
          current,
          leaseOwner,
          leaseToken,
          clock(),
          leaseMs,
        );
        if (renewed === undefined) return leaseLost(current);
        current = renewed;
        const extraction = await bounded(
          (operationSignal) =>
            this.pipeline.extractFile(
              {
                bytes,
                fileName: current.fileName,
                mimeType: current.mimeType,
                signal: operationSignal,
              },
              extractionAttempts(current) + 1,
              clock(),
            ),
          leaseMs,
          signal,
        );
        if (extraction.status === "failed") {
          // OCR is enrichment for images, not the authorization boundary for
          // using a scan-clean binary with a vision-capable model. Preserve
          // the failure provenance for search/accessibility diagnostics while
          // allowing the governed original to become attachable.
          if (current.mimeType.startsWith("image/")) {
            return this.finishReady(
              current,
              { extraction },
              leaseOwner,
              leaseToken,
              clock(),
            );
          }
          return this.finishFailure(
            current,
            { code: extraction.failureCode ?? "file_extraction_failed" },
            leaseOwner,
            leaseToken,
            clock(),
            { extraction },
          );
        }
        return this.finishReady(
          current,
          { extraction },
          leaseOwner,
          leaseToken,
          clock(),
        );
      }
      if (current.status === "transcoding")
        return this.finishReady(current, {}, leaseOwner, leaseToken, clock());
      return this.finishFailure(
        current,
        new Error("Unsupported lifecycle worker state."),
        leaseOwner,
        leaseToken,
        clock(),
      );
    } catch (error) {
      if (error instanceof ApiError && error.code === "file_malware_detected") {
        await deleteFileObjectStoredObjects(this.objectStore, current);
        const deletedAt = clock();
        const deleted = tombstoneFileObject(
          transitionFileLifecycle(current, "deleted", deletedAt),
          deletedAt,
        );
        const result = await this.repository.finishFileLifecycleLease({
          file: deleted,
          leaseOwner,
          leaseToken,
          now: deletedAt,
        });
        return result === undefined
          ? leaseLost(current)
          : { fileId: result.id, outcome: "rejected", state: result.status };
      }
      const failure =
        error instanceof ObjectSizeLimitError
          ? Object.assign(new Error("Stored file size exceeds its bound."), {
              code: "file_size_mismatch",
            })
          : error;
      return this.finishFailure(
        current,
        failure,
        leaseOwner,
        leaseToken,
        clock(),
      );
    }
  }

  private renew(
    current: FileObject,
    leaseOwner: string,
    leaseToken: string,
    now: string,
    leaseMs: number,
  ): Promise<FileObject | undefined> {
    return this.repository.renewFileLifecycleLease({
      fileId: current.id,
      leaseOwner,
      leaseToken,
      now,
      leaseExpiresAt: new Date(Date.parse(now) + leaseMs).toISOString(),
    });
  }

  private async finishReady(
    current: FileObject,
    metadata: Record<string, unknown>,
    leaseOwner: string,
    leaseToken: string,
    now: string,
  ): Promise<FileLifecycleWorkerResult> {
    const ready = transitionFileLifecycle(current, "ready", now, {
      metadata: { ...current.metadata, ...metadata },
    });
    delete ready.lifecycleFailureCode;
    delete ready.lifecycleNextAttemptAt;
    const result = await this.repository.finishFileLifecycleLease({
      file: ready,
      leaseOwner,
      leaseToken,
      now,
    });
    return result === undefined
      ? leaseLost(current)
      : { fileId: result.id, outcome: "completed", state: result.status };
  }

  private async finishFailure(
    current: FileObject,
    error: unknown,
    leaseOwner: string,
    leaseToken: string,
    now: string,
    metadata: Record<string, unknown> = {},
  ): Promise<FileLifecycleWorkerResult> {
    const attempts = current.lifecycleAttempts ?? 0;
    const failureCode = safeFileLifecycleFailureCode(error);
    const exhausted = attempts >= fileLifecycleMaxAttempts;
    const failed = transitionFileLifecycle(current, "failed", now, {
      lifecycleFailureCode: failureCode,
      ...(exhausted
        ? {}
        : {
            lifecycleNextAttemptAt: new Date(
              Date.parse(now) + fileLifecycleRetryDelayMs(attempts),
            ).toISOString(),
          }),
      metadata: {
        ...current.metadata,
        ...metadata,
        ...(exhausted
          ? {
              fileLifecycleDeadLetter: {
                schemaVersion: 1,
                attempts,
                failedAt: now,
                failureCode,
              },
            }
          : {}),
      },
    });
    if (exhausted) delete failed.lifecycleNextAttemptAt;
    const result = await this.repository.finishFileLifecycleLease({
      file: failed,
      leaseOwner,
      leaseToken,
      now,
    });
    return result === undefined
      ? leaseLost(current)
      : { fileId: result.id, outcome: "failed", state: result.status };
  }
}

function configuredUploadLimit(
  file: FileObject,
  limits: FileServiceLimits,
): number {
  switch (file.metadata.uploadMode) {
    case "inline":
      return limits.inlineMaxBytes;
    case "direct_presigned_put":
      return limits.directUploadMaxBytes;
    case "resumable_backend_composed":
      return limits.resumableUploadMaxBytes;
    default:
      return Math.max(
        limits.inlineMaxBytes,
        limits.directUploadMaxBytes,
        limits.resumableUploadMaxBytes,
      );
  }
}

function leaseLost(file: FileObject): FileLifecycleWorkerResult {
  return { fileId: file.id, outcome: "lease_lost", state: file.status };
}

async function bounded<T>(
  work: (signal: AbortSignal) => Promise<T>,
  leaseMs: number,
  signal?: AbortSignal,
): Promise<T> {
  const timeoutMs = Math.max(500, Math.floor(leaseMs * 0.8));
  if (signal?.aborted === true) throw lifecycleAbortError();
  const timeout = new AbortController();
  const timer = setTimeout(
    () => timeout.abort(lifecycleTimeoutError()),
    timeoutMs,
  );
  timer.unref?.();
  const combined =
    signal === undefined
      ? timeout.signal
      : AbortSignal.any([signal, timeout.signal]);
  try {
    return await work(combined);
  } catch (error) {
    if (timeout.signal.aborted) throw lifecycleTimeoutError();
    if (combined.aborted) throw lifecycleAbortError();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function lifecycleAbortError(): Error {
  return Object.assign(new Error("File lifecycle work aborted."), {
    code: "file_lifecycle_aborted",
  });
}

function lifecycleTimeoutError(): Error {
  return Object.assign(new Error("File lifecycle work timed out."), {
    code: "file_lifecycle_timeout",
  });
}

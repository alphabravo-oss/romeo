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
  safeFileLifecycleFailureCode,
  transitionFileLifecycle,
} from "./file-lifecycle";
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
  }): Promise<FileLifecycleWorkerResult> {
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
    return this.processClaimed(
      claimed,
      input.workerId,
      leaseToken,
      clock,
      leaseMs,
    );
  }

  private async processClaimed(
    claimed: FileObject,
    leaseOwner: string,
    leaseToken: string,
    clock: () => string,
    leaseMs: number,
  ): Promise<FileLifecycleWorkerResult> {
    let current = claimed;
    try {
      const now = clock();
      const bytes = await this.objectStore.getObject(current.objectKey, {
        maxBytes: Math.min(
          current.sizeBytes,
          configuredUploadLimit(current, this.limits),
        ),
      });
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
          this.pipeline.assertMalwareScanClean(
            bytes,
            current.fileName,
            current.mimeType,
          ),
          leaseMs,
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
          this.pipeline.extractFile(
            {
              bytes,
              fileName: current.fileName,
              mimeType: current.mimeType,
            },
            extractionAttempts(current) + 1,
            clock(),
          ),
          leaseMs,
        );
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
  ): Promise<FileLifecycleWorkerResult> {
    const failed = transitionFileLifecycle(current, "failed", now, {
      lifecycleFailureCode: safeFileLifecycleFailureCode(error),
      lifecycleNextAttemptAt: new Date(Date.parse(now) + 60_000).toISOString(),
    });
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

function bounded<T>(work: Promise<T>, leaseMs: number): Promise<T> {
  const timeoutMs = Math.max(500, Math.floor(leaseMs * 0.8));
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          Object.assign(new Error("File lifecycle work timed out."), {
            code: "file_lifecycle_timeout",
          }),
        ),
      timeoutMs,
    );
    timer.unref?.();
    work.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

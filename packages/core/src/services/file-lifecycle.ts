import type { FileObject, FileObjectStatus } from "../domain/entities";
import { ApiError } from "../errors";

const readyStates = new Set<FileObjectStatus>([
  "available",
  "ready",
  "attached",
  "retained",
]);

const transitions: Record<FileObjectStatus, ReadonlySet<FileObjectStatus>> = {
  uploading: new Set(["quarantined", "failed", "deleted"]),
  quarantined: new Set(["scanning", "failed", "deleted"]),
  scanning: new Set([
    "extracting",
    "transcoding",
    "ready",
    "failed",
    "deleted",
  ]),
  extracting: new Set(["transcoding", "ready", "failed", "deleted"]),
  transcoding: new Set(["ready", "failed", "deleted"]),
  ready: new Set(["attached", "retained", "failed", "deleted"]),
  attached: new Set(["ready", "retained", "deleted"]),
  retained: new Set(["deleted"]),
  failed: new Set(["quarantined", "deleted"]),
  available: new Set(["ready", "attached", "retained", "deleted"]),
  deleted: new Set(),
};

export function isFileReadyForUse(file: Pick<FileObject, "status">): boolean {
  return readyStates.has(file.status);
}

export function isFileRetentionDeletable(
  file: Pick<FileObject, "status">,
): boolean {
  return (
    file.status === "available" ||
    file.status === "ready" ||
    file.status === "attached"
  );
}

export function assertFileReadyForUse(file: Pick<FileObject, "status">): void {
  if (isFileReadyForUse(file)) return;
  throw new ApiError(
    "file_not_ready",
    "The file has not completed its security lifecycle.",
    409,
  );
}

export function assertFileLifecycleTransition(
  current: FileObject,
  next: FileObject,
): void {
  if (current.id !== next.id || current.orgId !== next.orgId)
    throw new Error("File lifecycle identity cannot change.");
  if (current.status === next.status) {
    if ((next.lifecycleVersion ?? 0) < (current.lifecycleVersion ?? 0))
      throw new Error("File lifecycle version cannot move backward.");
    return;
  }
  if (!transitions[current.status].has(next.status))
    throw new ApiError(
      "file_lifecycle_transition_invalid",
      "The requested file lifecycle transition is not allowed.",
      409,
    );
  if ((next.lifecycleVersion ?? 0) !== (current.lifecycleVersion ?? 0) + 1)
    throw new ApiError(
      "file_lifecycle_version_conflict",
      "The file lifecycle changed before this operation completed.",
      409,
    );
}

export function transitionFileLifecycle(
  file: FileObject,
  status: FileObjectStatus,
  now = new Date().toISOString(),
  patch: Partial<FileObject> = {},
): FileObject {
  const next: FileObject = {
    ...file,
    ...patch,
    status,
    lifecycleVersion:
      (file.lifecycleVersion ?? 0) + (status === file.status ? 0 : 1),
    updatedAt: now,
  };
  assertFileLifecycleTransition(file, next);
  return next;
}

/** Only the transactional reference/hold reconciler may release retention. */
export function transitionFileRetentionReconciliation(
  file: FileObject,
  status: "attached" | "ready" | "retained",
  now: string,
): FileObject {
  if (file.status !== "retained" || status === "retained")
    return transitionFileLifecycle(file, status, now);
  return {
    ...file,
    status,
    lifecycleVersion: (file.lifecycleVersion ?? 0) + 1,
    updatedAt: now,
  };
}

export function safeFileLifecycleFailureCode(error: unknown): string {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : undefined;
  if (code !== undefined && lifecycleFailureCodes.has(code)) return code;
  return "file_lifecycle_failed";
}

const lifecycleFailureCodes = new Set([
  "file_extraction_failed",
  "file_malware_scan_unavailable",
  "file_object_missing",
  "file_size_mismatch",
  "file_ocr_failed",
  "file_ocr_unavailable",
]);

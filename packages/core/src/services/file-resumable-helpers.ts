import type { ObjectStore } from "@romeo/storage";

import type { FileObject } from "../domain/entities";
import { ApiError } from "../errors";

const defaultResumablePartSizeBytes = 16_000_000;
const maxResumablePartCount = 1_000;

export interface ResumableUploadPlan {
  partCount: number;
  partSizeBytes: number;
}

export async function deleteFileObjectStoredObjects(
  objectStore: ObjectStore,
  file: FileObject,
): Promise<void> {
  await Promise.all(
    fileObjectStoredObjectKeys(file).map((key) =>
      objectStore.deleteObject(key),
    ),
  );
}

export function fileObjectStoredObjectCount(
  file: Pick<FileObject, "metadata">,
): number {
  return isResumableUploadFile(file)
    ? resumablePlanFromFile(file).partCount + 1
    : 1;
}

function fileObjectStoredObjectKeys(file: FileObject): string[] {
  const keys = isResumableUploadFile(file)
    ? partNumbers(resumablePlanFromFile(file).partCount).map((partNumber) =>
        resumablePartObjectKey(file.objectKey, partNumber),
      )
    : [];
  return [...keys, file.objectKey];
}

export function normalizeResumableUploadPlan(
  sizeBytes: number,
  requestedPartSizeBytes: number | undefined,
  directUploadMaxBytes: number,
): ResumableUploadPlan {
  const partSizeBytes = requestedPartSizeBytes ?? defaultResumablePartSizeBytes;
  if (
    !Number.isInteger(partSizeBytes) ||
    partSizeBytes <= 0 ||
    partSizeBytes > directUploadMaxBytes
  ) {
    throw new ApiError(
      "file_part_size_invalid",
      "Resumable upload part size is outside the supported range.",
      400,
      { maxPartSizeBytes: directUploadMaxBytes },
    );
  }
  const partCount = Math.ceil(sizeBytes / partSizeBytes);
  if (partCount > maxResumablePartCount) {
    throw new ApiError(
      "file_part_count_invalid",
      "Resumable upload requires too many parts.",
      400,
      { maxPartCount: maxResumablePartCount },
    );
  }
  return { partCount, partSizeBytes };
}

export function isResumableUploadFile(
  file: Pick<FileObject, "metadata">,
): boolean {
  return file.metadata.uploadMode === "resumable_backend_composed";
}

export function resumablePlanFromFile(
  file: Pick<FileObject, "metadata">,
): ResumableUploadPlan {
  if (!isResumableUploadFile(file)) {
    throw new ApiError(
      "file_upload_mode_mismatch",
      "The file upload session is not resumable.",
      409,
    );
  }
  const partCount = file.metadata.partCount;
  const partSizeBytes = file.metadata.partSizeBytes;
  if (
    typeof partCount !== "number" ||
    typeof partSizeBytes !== "number" ||
    !Number.isInteger(partCount) ||
    partCount <= 0 ||
    partCount > maxResumablePartCount ||
    !Number.isInteger(partSizeBytes) ||
    partSizeBytes <= 0
  ) {
    throw new ApiError(
      "file_upload_plan_invalid",
      "The file upload session metadata is invalid.",
      409,
    );
  }
  return { partCount, partSizeBytes };
}

export function partNumbers(partCount: number): number[] {
  return Array.from({ length: partCount }, (_value, index) => index + 1);
}

export function expectedPartSize(
  totalSizeBytes: number,
  resumable: ResumableUploadPlan,
  partNumber: number,
): number {
  return partNumber < resumable.partCount
    ? resumable.partSizeBytes
    : totalSizeBytes - resumable.partSizeBytes * (resumable.partCount - 1);
}

export function resumablePartObjectKey(
  objectKey: string,
  partNumber: number,
): string {
  return `${objectKey}.parts/${String(partNumber).padStart(6, "0")}`;
}

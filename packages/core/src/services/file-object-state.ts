import { hasGrant, type AuthSubject, type ResourceGrant } from "@romeo/auth";

import type { FileObject } from "../domain/entities";
import { ApiError } from "../errors";
import type {
  FileExtractionState,
  FileObjectResponse,
} from "./file-service-contracts";
import { isDeferredExtractionMimeType } from "./knowledge-extraction-worker";
import { isFileReadyForUse } from "./file-lifecycle";

export function canReadFile(
  subject: AuthSubject,
  grants: ResourceGrant[],
  file: FileObject,
): boolean {
  return hasFilePermission(subject, grants, file, "read");
}

export function hasFilePermission(
  subject: AuthSubject,
  grants: ResourceGrant[],
  file: FileObject,
  permission: "read" | "write",
): boolean {
  if (subject.isAdmin === true) return true;
  if (file.ownerType === subject.type && file.ownerId === subject.id)
    return true;
  return hasGrant(subject, grants, "file", file.id, permission);
}

export function publicFileObject(file: FileObject): FileObjectResponse {
  return {
    id: file.id,
    workspaceId: file.workspaceId,
    ownerType: file.ownerType,
    ownerId: file.ownerId,
    fileName: file.fileName,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
    purpose: file.purpose,
    status: file.status,
    lifecycle: {
      schemaVersion: 1,
      state: file.status,
      version: file.lifecycleVersion ?? 0,
      attempts: file.lifecycleAttempts ?? 0,
      retryable:
        file.status === "failed" && (file.lifecycleAttempts ?? 0) < 100,
      failureCode: file.lifecycleFailureCode ?? null,
      nextAttemptAt: file.lifecycleNextAttemptAt ?? null,
      // Lease timing is an internal worker coordination detail.
      leaseExpiresAt: null,
      attachedAt: file.attachedAt ?? null,
      retainedAt: file.retainedAt ?? null,
    },
    metadata: file.metadata,
    extraction: publicExtractionState(file),
    contentUrl: isFileReadyForUse(file)
      ? `/api/v1/files/${encodeURIComponent(file.id)}/content`
      : null,
    createdAt: file.createdAt,
    updatedAt: file.updatedAt,
    ...(file.deletedAt === undefined ? {} : { deletedAt: file.deletedAt }),
  };
}

export function initialExtractionState(mimeType: string): FileExtractionState {
  return isExtractableMimeType(mimeType)
    ? {
        status: "pending",
        quality: "unknown",
        method: extractionMethodFor(mimeType),
        attempts: 0,
        attemptedAt: null,
        completedAt: null,
        characterCount: null,
        failureCode: null,
        provider: null,
        pageCount: null,
        confidence: null,
      }
    : notApplicableExtractionState();
}

export function successfulExtractionState(input: {
  attempts: number;
  attemptedAt: string;
  characterCount: number;
  method: string;
  quality: "high" | "medium";
  provider: string;
  pageCount?: number;
  confidence?: number | null;
}): FileExtractionState {
  return {
    status: "succeeded",
    quality: input.quality,
    method: input.method,
    attempts: input.attempts,
    attemptedAt: input.attemptedAt,
    completedAt: new Date().toISOString(),
    characterCount: input.characterCount,
    failureCode: null,
    provider: input.provider,
    pageCount: input.pageCount ?? null,
    confidence: input.confidence ?? null,
  };
}

export function publicExtractionState(
  file: Pick<FileObject, "metadata" | "mimeType" | "status">,
): FileExtractionState {
  const fallback =
    file.status === "uploading" || isExtractableMimeType(file.mimeType)
      ? initialExtractionState(file.mimeType)
      : notApplicableExtractionState();
  const value = file.metadata.extraction;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fallback;
  }
  const record = value as Record<string, unknown>;
  const status = record.status;
  if (!isExtractionStatus(status)) return fallback;
  const quality = record.quality;
  return {
    status,
    quality: quality === "high" || quality === "medium" ? quality : "unknown",
    method: typeof record.method === "string" ? record.method : null,
    attempts: nonNegativeInteger(record.attempts) ?? 0,
    attemptedAt:
      typeof record.attemptedAt === "string" ? record.attemptedAt : null,
    completedAt:
      typeof record.completedAt === "string" ? record.completedAt : null,
    characterCount: nonNegativeInteger(record.characterCount),
    failureCode:
      typeof record.failureCode === "string" ? record.failureCode : null,
    provider: typeof record.provider === "string" ? record.provider : null,
    pageCount:
      typeof record.pageCount === "number" && Number.isInteger(record.pageCount)
        ? record.pageCount
        : null,
    confidence:
      typeof record.confidence === "number" &&
      record.confidence >= 0 &&
      record.confidence <= 1
        ? record.confidence
        : null,
  };
}

export function extractionAttempts(
  file: Pick<FileObject, "metadata" | "mimeType" | "status">,
): number {
  return publicExtractionState(file).attempts;
}

export function safeExtractionFailureCode(error: unknown): string {
  if (error instanceof ApiError && isSafeFailureCode(error.code)) {
    return error.code;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    isSafeFailureCode(error.code)
  ) {
    return error.code;
  }
  return "file_extraction_failed";
}

export function isExtractableMimeType(mimeType: string): boolean {
  return (
    mimeType.startsWith("image/") ||
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    isDeferredExtractionMimeType(mimeType)
  );
}

export function notApplicableExtractionState(): FileExtractionState {
  return {
    status: "not_applicable",
    quality: "unknown",
    method: null,
    attempts: 0,
    attemptedAt: null,
    completedAt: null,
    characterCount: null,
    failureCode: null,
    provider: null,
    pageCount: null,
    confidence: null,
  };
}

export function extractionMethodFor(mimeType: string): string | null {
  if (mimeType.startsWith("image/")) return "ocr";
  if (mimeType === "application/pdf") return "pdftotext";
  if (isDeferredExtractionMimeType(mimeType)) return "ooxml-text";
  if (mimeType.startsWith("text/") || mimeType === "application/json") {
    return "utf8-text";
  }
  return null;
}

function isExtractionStatus(
  value: unknown,
): value is FileExtractionState["status"] {
  return (
    value === "failed" ||
    value === "not_applicable" ||
    value === "pending" ||
    value === "processing" ||
    value === "succeeded"
  );
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function isSafeFailureCode(value: string): boolean {
  return /^[a-z0-9_]{1,80}$/u.test(value);
}

import type { FileObjectPurpose } from "../domain/entities";
import { ApiError } from "../errors";

export interface FileObjectResponse {
  id: string;
  workspaceId: string;
  ownerType: "service_account" | "user";
  ownerId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  purpose: FileObjectPurpose;
  status: "available" | "deleted" | "uploading";
  metadata: Record<string, unknown>;
  extraction: FileExtractionState;
  contentUrl: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export type FileExtractionStatus =
  | "failed"
  | "not_applicable"
  | "pending"
  | "processing"
  | "succeeded";

export interface FileExtractionState {
  status: FileExtractionStatus;
  quality: "high" | "medium" | "unknown";
  method: string | null;
  attempts: number;
  attemptedAt: string | null;
  completedAt: string | null;
  characterCount: number | null;
  failureCode: string | null;
  provider: string | null;
  pageCount: number | null;
  confidence: number | null;
}

export interface CreateFileObjectInput {
  workspaceId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  dataBase64: string;
  purpose?: FileObjectPurpose | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface CreateFileUploadSessionInput {
  workspaceId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  purpose?: FileObjectPurpose | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface CreateFileResumableUploadSessionInput extends CreateFileUploadSessionInput {
  partSizeBytes?: number | undefined;
}

export interface FileUploadSessionResponse {
  file: FileObjectResponse;
  upload: {
    url: string;
    method: "PUT";
    headers: Record<string, string>;
    expiresAt: string;
    maxBytes: number;
  };
}

export interface FileResumableUploadPartResponse {
  partNumber: number;
  sizeBytes: number;
  upload: {
    url: string;
    method: "PUT";
    headers: Record<string, string>;
    expiresAt: string;
  };
}

export interface FileResumableUploadSessionResponse {
  file: FileObjectResponse;
  upload: {
    mode: "resumable_backend_composed";
    partCount: number;
    partSizeBytes: number;
    maxBytes: number;
    parts: FileResumableUploadPartResponse[];
  };
}

export interface FileServiceLimits {
  directUploadMaxBytes: number;
  inlineMaxBytes: number;
  resumableUploadMaxBytes: number;
}

export interface FileMalwareScanner {
  scan(input: {
    bytes: Uint8Array;
    fileName: string;
    mimeType: string;
  }): Promise<{ verdict: "clean" | "malicious" | "unavailable" }>;
}

export type FileMalwareScanPolicy = "off" | "required";

export async function assertFileMalwareScanClean(
  scanning: { policy: FileMalwareScanPolicy; scanner?: FileMalwareScanner },
  input: { bytes: Uint8Array; fileName: string; mimeType: string },
): Promise<void> {
  if (scanning.policy === "off") return;
  const scanner = scanning.scanner;
  if (scanner === undefined) {
    throw unavailableScanner();
  }
  let verdict: "clean" | "malicious" | "unavailable";
  try {
    verdict = (await scanner.scan(input)).verdict;
  } catch {
    verdict = "unavailable";
  }
  if (verdict === "clean") return;
  if (verdict === "malicious") {
    throw new ApiError(
      "file_malware_detected",
      "The file was rejected by organization security policy.",
      422,
    );
  }
  throw unavailableScanner();
}

function unavailableScanner(): ApiError {
  return new ApiError(
    "file_malware_scan_unavailable",
    "File scanning is required but temporarily unavailable.",
    503,
  );
}

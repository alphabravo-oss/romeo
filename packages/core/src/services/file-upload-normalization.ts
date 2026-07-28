import { createHash } from "node:crypto";

import { ApiError } from "../errors";
import { assertFileContentMatchesMimeType } from "./file-signature";
import type { CreateFileObjectInput } from "./file-service-contracts";

const allowedMimeTypes = new Set([
  "application/json",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/csv",
  "text/html",
  "text/markdown",
  "text/plain",
]);

export interface NormalizedFileMetadata {
  fileName: string;
  mimeType: string;
  sha256: string;
  sizeBytes: number;
}

export function normalizeFileInput(
  input: CreateFileObjectInput,
  inlineMaxBytes: number,
): Pick<NormalizedFileMetadata, "fileName" | "mimeType"> & {
  bytes: Uint8Array;
} {
  const metadata = normalizeFileMetadataInput(input, inlineMaxBytes);
  const maxBase64Length = base64LengthLimitFor(inlineMaxBytes);
  if (input.dataBase64.length > maxBase64Length) {
    throw new ApiError(
      "file_base64_too_large",
      "File upload encoding is outside the supported range.",
      400,
      { maxBase64Length },
    );
  }
  const bytes = decodeBase64(input.dataBase64);
  if (bytes.byteLength !== input.sizeBytes) {
    throw new ApiError(
      "file_size_mismatch",
      "File byte count does not match the declared size.",
      400,
    );
  }
  assertFileContentMatchesMimeType(bytes, metadata.mimeType);
  return { bytes, fileName: metadata.fileName, mimeType: metadata.mimeType };
}

export function normalizeFileMetadataInput(
  input: {
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    sha256?: string;
  },
  maxBytes: number,
): NormalizedFileMetadata {
  const mimeType = input.mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!allowedMimeTypes.has(mimeType)) {
    throw new ApiError(
      "unsupported_file_type",
      "The file type is not supported for direct upload.",
      415,
      { mimeType: input.mimeType },
    );
  }
  if (
    !Number.isInteger(input.sizeBytes) ||
    input.sizeBytes <= 0 ||
    input.sizeBytes > maxBytes
  ) {
    throw new ApiError(
      "file_size_invalid",
      "File size is outside the supported range.",
      400,
      { maxBytes },
    );
  }
  return {
    fileName: safeFileName(input.fileName),
    mimeType,
    sizeBytes: input.sizeBytes,
    sha256:
      input.sha256 === undefined ? "" : normalizeExpectedSha256(input.sha256),
  };
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function base64LengthLimitFor(maxBytes: number): number {
  return Math.ceil(maxBytes / 3) * 4 + 1024;
}

function decodeBase64(value: string): Uint8Array {
  const raw = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
  if (
    raw.length === 0 ||
    raw.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]*={0,2}$/u.test(raw)
  ) {
    throw new ApiError(
      "file_base64_invalid",
      "File must be valid base64.",
      400,
    );
  }
  return new Uint8Array(Buffer.from(raw, "base64"));
}

function safeFileName(fileName: string): string {
  const leaf = fileName.split(/[\\/]/u).pop()?.trim() ?? "";
  const normalized = leaf
    .replace(/[^A-Za-z0-9._-]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 160);
  return normalized.length === 0 ? "upload" : normalized;
}

function normalizeExpectedSha256(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(normalized)) {
    throw new ApiError(
      "file_sha256_invalid",
      "File checksum must be a lowercase SHA-256 hex digest.",
      400,
    );
  }
  return normalized;
}

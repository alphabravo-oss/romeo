import { ApiError } from "../errors";
import { assertFileContentMatchesMimeType } from "./file-signature";
import type { ChatAttachmentInput } from "./message-attachments";

const allowedImageMimeTypes = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const allowedDocumentMimeTypes = new Set([
  "application/json",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/csv",
  "text/html",
  "text/markdown",
  "text/plain",
]);

export function normalizeAttachmentBytes(
  input: ChatAttachmentInput,
  maxBytes = 25_000_000,
): {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
} {
  const mimeType = input.mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (
    !allowedImageMimeTypes.has(mimeType) &&
    !allowedDocumentMimeTypes.has(mimeType)
  ) {
    throw new ApiError(
      "unsupported_message_attachment_type",
      "The attachment MIME type is not supported.",
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
      "message_attachment_size_invalid",
      "Attachment size is outside the supported range.",
      400,
      { maxBytes },
    );
  }
  const bytes = decodeBase64(input.dataBase64);
  if (bytes.byteLength !== input.sizeBytes) {
    throw new ApiError(
      "message_attachment_size_mismatch",
      "Attachment byte count does not match the declared size.",
      400,
    );
  }
  assertFileContentMatchesMimeType(bytes, mimeType, {
    code: "message_attachment_mime_mismatch",
    message: "Attachment bytes do not match the declared MIME type.",
  });
  return { bytes, fileName: safeFileName(input.fileName), mimeType };
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

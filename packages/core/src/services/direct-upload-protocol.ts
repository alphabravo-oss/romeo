export type DirectUploadDeniedCode =
  | "file_upload_not_active"
  | "file_upload_missing"
  | "file_size_mismatch"
  | "file_sha256_mismatch"
  | "file_mime_mismatch";

export type DirectUploadProtocolResult =
  | { outcome: "already_ready" }
  | { outcome: "resumable" }
  | { outcome: "accepted"; bytes: Uint8Array }
  | {
      outcome: "denied";
      code: DirectUploadDeniedCode;
      deleteObject: boolean;
    };

export function validateUploadStreamChunk(input: {
  receivedBytes: number;
  chunkLength: number;
  declaredSizeBytes: number;
  maxBytes: number;
}):
  | { outcome: "continue"; receivedBytes: number }
  | { outcome: "complete"; receivedBytes: number }
  | { outcome: "denied"; code: "file_size_mismatch" } {
  if (input.chunkLength < 0) return { outcome: "denied", code: "file_size_mismatch" };
  const receivedBytes = input.receivedBytes + input.chunkLength;
  if (receivedBytes > input.declaredSizeBytes || receivedBytes > input.maxBytes)
    return { outcome: "denied", code: "file_size_mismatch" };
  if (receivedBytes === input.declaredSizeBytes)
    return { outcome: "complete", receivedBytes };
  return { outcome: "continue", receivedBytes };
}

export async function completeDirectUploadProtocol(input: {
  alreadyReady: boolean;
  status: string;
  isResumable: boolean;
  headSupported: boolean;
  head?: { sizeBytes: number };
  declaredSizeBytes: number;
  maxBytes: number;
  sha256Declared: string;
  mimeType: string;
  readBytes: () => Promise<Uint8Array | undefined>;
  sha256Hex: (bytes: Uint8Array) => string;
  assertMime: (bytes: Uint8Array, mimeType: string) => void;
}): Promise<DirectUploadProtocolResult> {
  if (input.alreadyReady) return { outcome: "already_ready" };
  if (input.status !== "uploading")
    return {
      outcome: "denied",
      code: "file_upload_not_active",
      deleteObject: false,
    };
  if (input.isResumable) return { outcome: "resumable" };
  if (input.headSupported && input.head === undefined)
    return {
      outcome: "denied",
      code: "file_upload_missing",
      deleteObject: false,
    };
  if (
    input.head !== undefined &&
    (input.head.sizeBytes !== input.declaredSizeBytes ||
      input.head.sizeBytes > input.maxBytes)
  ) {
    return {
      outcome: "denied",
      code: "file_size_mismatch",
      deleteObject: true,
    };
  }
  let bytes: Uint8Array | undefined;
  try {
    bytes = await input.readBytes();
  } catch {
    return {
      outcome: "denied",
      code: "file_size_mismatch",
      deleteObject: true,
    };
  }
  if (bytes === undefined)
    return {
      outcome: "denied",
      code: "file_upload_missing",
      deleteObject: false,
    };
  const streamed = validateUploadStreamChunk({
    receivedBytes: 0,
    chunkLength: bytes.byteLength,
    declaredSizeBytes: input.declaredSizeBytes,
    maxBytes: input.maxBytes,
  });
  if (streamed.outcome === "denied" || bytes.byteLength !== input.declaredSizeBytes)
    return {
      outcome: "denied",
      code: "file_size_mismatch",
      deleteObject: true,
    };
  if (input.sha256Hex(bytes) !== input.sha256Declared)
    return {
      outcome: "denied",
      code: "file_sha256_mismatch",
      deleteObject: true,
    };
  try {
    input.assertMime(bytes, input.mimeType);
  } catch {
    return {
      outcome: "denied",
      code: "file_mime_mismatch",
      deleteObject: true,
    };
  }
  return { outcome: "accepted", bytes };
}

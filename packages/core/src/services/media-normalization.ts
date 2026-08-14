const extensionMimeTypes: Record<string, string> = {
  csv: "text/csv",
  gif: "image/gif",
  htm: "text/html",
  html: "text/html",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  json: "application/json",
  md: "text/markdown",
  pdf: "application/pdf",
  png: "image/png",
  txt: "text/plain",
  webp: "image/webp",
};

export function normalizeUploadedMedia(input: {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
  stripMetadata: boolean;
  retentionPermitsOriginal: boolean;
  signatureMatches: boolean;
}):
  | {
      outcome: "accepted";
      bytes: Uint8Array;
      originalPreserved: boolean;
      metadataStripped: boolean;
      transcodeRequested: boolean;
    }
  | { outcome: "denied"; code: "file_mime_mismatch" } {
  if (!input.signatureMatches)
    return { outcome: "denied", code: "file_mime_mismatch" };
  const extension = fileExtension(input.fileName);
  const expectedMime = extension === undefined ? undefined : extensionMimeTypes[extension];
  if (expectedMime !== undefined && expectedMime !== input.mimeType)
    return { outcome: "denied", code: "file_mime_mismatch" };
  if (!input.stripMetadata) {
    return {
      outcome: "accepted",
      bytes: input.bytes,
      originalPreserved: input.retentionPermitsOriginal,
      metadataStripped: false,
      transcodeRequested: false,
    };
  }
  const stripped = stripUnsafeMetadata(input.bytes, input.mimeType);
  return {
    outcome: "accepted",
    bytes: stripped,
    originalPreserved: input.retentionPermitsOriginal,
    metadataStripped: stripped.byteLength !== input.bytes.byteLength,
    transcodeRequested: input.mimeType === "image/gif" || input.mimeType === "image/webp",
  };
}

function fileExtension(fileName: string): string | undefined {
  const leaf = fileName.split(/[\\/]/u).pop() ?? "";
  const index = leaf.lastIndexOf(".");
  if (index <= 0 || index === leaf.length - 1) return undefined;
  return leaf.slice(index + 1).toLowerCase();
}

function stripUnsafeMetadata(bytes: Uint8Array, mimeType: string): Uint8Array {
  if (mimeType === "image/jpeg") return stripJpegMetadata(bytes);
  if (mimeType === "image/png") return stripPngMetadata(bytes);
  return bytes;
}

function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
  const chunks: Uint8Array[] = [bytes.subarray(0, 2)];
  let index = 2;
  while (index + 3 < bytes.length) {
    if (bytes[index] !== 0xff) {
      chunks.push(bytes.subarray(index));
      break;
    }
    const marker = bytes[index + 1]!;
    if (marker === 0xda) {
      chunks.push(bytes.subarray(index));
      break;
    }
    if (marker === 0x00 || marker === 0xd8 || marker === 0xd9) {
      chunks.push(bytes.subarray(index, index + 2));
      index += 2;
      continue;
    }
    const length = (bytes[index + 2]! << 8) | bytes[index + 3]!;
    if (length < 2) {
      chunks.push(bytes.subarray(index));
      break;
    }
    const skip = marker === 0xe1 || marker === 0xed;
    if (!skip) chunks.push(bytes.subarray(index, index + 2 + length));
    index += 2 + length;
  }
  return concatChunks(chunks);
}

function stripPngMetadata(bytes: Uint8Array): Uint8Array {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (
    bytes.length < 16 ||
    signature.some((value, index) => bytes[index] !== value)
  )
    return bytes;
  const chunks: Uint8Array[] = [bytes.subarray(0, 8)];
  let index = 8;
  const dropped = new Set(["eXIf", "iTXt", "tEXt", "zTXt"]);
  while (index + 12 <= bytes.length) {
    const length =
      (bytes[index]! << 24) |
      (bytes[index + 1]! << 16) |
      (bytes[index + 2]! << 8) |
      bytes[index + 3]!;
    const type = String.fromCharCode(
      bytes[index + 4]!,
      bytes[index + 5]!,
      bytes[index + 6]!,
      bytes[index + 7]!,
    );
    const end = index + 12 + length;
    if (end > bytes.length) {
      chunks.push(bytes.subarray(index));
      break;
    }
    if (!dropped.has(type)) chunks.push(bytes.subarray(index, end));
    index = end;
  }
  return concatChunks(chunks);
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

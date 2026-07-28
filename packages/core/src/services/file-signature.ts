import { ApiError } from "../errors";

const textDecoder = new TextDecoder("utf-8", { fatal: true });

const ooxmlMimeTypes = new Set([
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const imageMimeTypes = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const maxImageDimension = 16_384;
const maxImagePixels = 100_000_000;

export function assertFileContentMatchesMimeType(
  bytes: Uint8Array,
  mimeType: string,
  options: {
    code?: string;
    message?: string;
  } = {},
): void {
  if (!matchesDeclaredMimeType(bytes, mimeType)) {
    throw new ApiError(
      options.code ?? "file_mime_mismatch",
      options.message ?? "File bytes do not match the declared MIME type.",
      415,
      { mimeType },
    );
  }
  if (!imageMimeTypes.has(mimeType)) return;
  const dimensions = imageDimensions(bytes, mimeType);
  if (
    dimensions === undefined ||
    dimensions.width <= 0 ||
    dimensions.height <= 0
  ) {
    throw new ApiError(
      "file_image_dimensions_invalid",
      "Image dimensions could not be validated.",
      415,
      { mimeType },
    );
  }
  if (
    dimensions.width > maxImageDimension ||
    dimensions.height > maxImageDimension ||
    dimensions.width * dimensions.height > maxImagePixels
  ) {
    throw new ApiError(
      "file_image_dimensions_exceeded",
      "Image dimensions exceed the supported safety limit.",
      413,
      { maxDimension: maxImageDimension, maxPixels: maxImagePixels },
    );
  }
}

function matchesDeclaredMimeType(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === "application/pdf") return startsWithAscii(bytes, "%PDF-");
  if (mimeType === "image/png")
    return startsWithBytes(
      bytes,
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    );
  if (mimeType === "image/jpeg")
    return startsWithBytes(bytes, [0xff, 0xd8, 0xff]);
  if (mimeType === "image/gif")
    return startsWithAscii(bytes, "GIF87a") || startsWithAscii(bytes, "GIF89a");
  if (mimeType === "image/webp")
    return (
      startsWithAscii(bytes, "RIFF") &&
      bytes.length >= 12 &&
      asciiAt(bytes, 8, 4) === "WEBP"
    );
  if (ooxmlMimeTypes.has(mimeType))
    return startsWithBytes(bytes, [0x50, 0x4b, 0x03, 0x04]);
  if (mimeType === "application/json") return isJsonText(bytes);
  if (
    mimeType === "text/plain" ||
    mimeType === "text/markdown" ||
    mimeType === "text/csv" ||
    mimeType === "text/html"
  ) {
    return isUtf8Text(bytes);
  }
  return false;
}

function isJsonText(bytes: Uint8Array): boolean {
  const text = decodeUtf8Text(bytes);
  if (text === undefined) return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function isUtf8Text(bytes: Uint8Array): boolean {
  return decodeUtf8Text(bytes) !== undefined;
}

function decodeUtf8Text(bytes: Uint8Array): string | undefined {
  try {
    const text = textDecoder.decode(bytes);
    return text.includes("\u0000") ? undefined : text;
  } catch {
    return undefined;
  }
}

function startsWithAscii(bytes: Uint8Array, value: string): boolean {
  return asciiAt(bytes, 0, value.length) === value;
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  if (bytes.length < offset + length) return "";
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function startsWithBytes(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((value, index) => bytes[index] === value);
}

function imageDimensions(
  bytes: Uint8Array,
  mimeType: string,
): { width: number; height: number } | undefined {
  if (mimeType === "image/png" && bytes.length >= 24) {
    return { width: readUint32Be(bytes, 16), height: readUint32Be(bytes, 20) };
  }
  if (mimeType === "image/gif" && bytes.length >= 10) {
    return { width: readUint16Le(bytes, 6), height: readUint16Le(bytes, 8) };
  }
  if (mimeType === "image/jpeg") return jpegDimensions(bytes);
  if (mimeType === "image/webp") return webpDimensions(bytes);
  return undefined;
}

function jpegDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | undefined {
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) return undefined;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === undefined || marker === 0xd9 || marker === 0xda)
      return undefined;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > bytes.length) return undefined;
    const length = readUint16Be(bytes, offset);
    if (length < 2 || offset + length > bytes.length) return undefined;
    if (isJpegStartOfFrame(marker) && length >= 7) {
      return {
        height: readUint16Be(bytes, offset + 3),
        width: readUint16Be(bytes, offset + 5),
      };
    }
    offset += length;
  }
  return undefined;
}

function isJpegStartOfFrame(marker: number): boolean {
  return (
    marker >= 0xc0 &&
    marker <= 0xcf &&
    marker !== 0xc4 &&
    marker !== 0xc8 &&
    marker !== 0xcc
  );
}

function webpDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | undefined {
  if (bytes.length < 30) return undefined;
  const chunk = asciiAt(bytes, 12, 4);
  if (chunk === "VP8X") {
    return {
      width: 1 + readUint24Le(bytes, 24),
      height: 1 + readUint24Le(bytes, 27),
    };
  }
  if (chunk === "VP8L" && bytes[20] === 0x2f) {
    const bits = readUint32Le(bytes, 21);
    return {
      width: 1 + (bits & 0x3fff),
      height: 1 + ((bits >>> 14) & 0x3fff),
    };
  }
  if (
    chunk === "VP8 " &&
    bytes[23] === 0x9d &&
    bytes[24] === 0x01 &&
    bytes[25] === 0x2a
  ) {
    return {
      width: readUint16Le(bytes, 26) & 0x3fff,
      height: readUint16Le(bytes, 28) & 0x3fff,
    };
  }
  return undefined;
}

function readUint16Be(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

function readUint16Le(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readUint24Le(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16)
  );
}

function readUint32Be(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! * 0x1000000 +
      (bytes[offset + 1]! << 16) +
      (bytes[offset + 2]! << 8) +
      bytes[offset + 3]!) >>>
    0
  );
}

function readUint32Le(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! +
      (bytes[offset + 1]! << 8) +
      (bytes[offset + 2]! << 16) +
      bytes[offset + 3]! * 0x1000000) >>>
    0
  );
}

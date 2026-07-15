import { ApiError } from "../errors";

const textDecoder = new TextDecoder("utf-8", { fatal: true });

const ooxmlMimeTypes = new Set([
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export function assertFileContentMatchesMimeType(
  bytes: Uint8Array,
  mimeType: string,
  options: {
    code?: string;
    message?: string;
  } = {},
): void {
  if (matchesDeclaredMimeType(bytes, mimeType)) return;
  throw new ApiError(
    options.code ?? "file_mime_mismatch",
    options.message ?? "File bytes do not match the declared MIME type.",
    415,
    { mimeType },
  );
}

function matchesDeclaredMimeType(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === "application/pdf") return startsWithAscii(bytes, "%PDF-");
  if (mimeType === "image/png")
    return startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
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

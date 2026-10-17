/**
 * Types a browser may render inline from Romeo's origin without running
 * anything. Everything else -- notably text/html, image/svg+xml, XHTML and
 * XML, which can carry script -- is served as a sandboxed download so an
 * uploaded file can never execute with the reader's session.
 */
const inlineSafeMimeTypes = new Set([
  "application/json",
  "application/pdf",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/csv",
  "text/markdown",
  "text/plain",
]);

export function isInlineSafeMimeType(mimeType: string): boolean {
  const essence = mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return (
    inlineSafeMimeTypes.has(essence) ||
    /^(?:audio|video)\/[a-z0-9.+-]+$/u.test(essence)
  );
}

export function fileContentHeaders(file: {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}): Record<string, string> {
  const inline = isInlineSafeMimeType(file.mimeType);
  return {
    "cache-control": "private, max-age=300",
    "content-disposition": contentDisposition(
      inline ? "inline" : "attachment",
      file.fileName,
    ),
    "content-length": String(file.sizeBytes),
    "content-type": file.mimeType,
    "x-content-type-options": "nosniff",
    ...(inline
      ? {}
      : { "content-security-policy": "default-src 'none'; sandbox" }),
  };
}

function contentDisposition(
  disposition: "attachment" | "inline",
  fileName: string,
): string {
  // The quoted fallback is restricted to printable ASCII so a hostile name
  // cannot break out of the header; the RFC 5987 form keeps the real name.
  const fallback = fileName.replace(/[^\x20-\x7e]|["\\]/gu, "_") || "file";
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeRfc5987(fileName, fallback)}`;
}

function encodeRfc5987(value: string, fallback: string): string {
  let encoded: string;
  try {
    encoded = encodeURIComponent(value);
  } catch {
    // Lone surrogates cannot be percent-encoded as UTF-8.
    encoded = encodeURIComponent(fallback);
  }
  return encoded.replace(
    /['()*!]/gu,
    (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
  );
}

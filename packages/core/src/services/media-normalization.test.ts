import { describe, expect, it } from "vitest";

import { normalizeUploadedMedia } from "./media-normalization";

const jpegWithExif = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe1, 0x00, 0x06, 0x45, 0x78, 0x69, 0x66, 0xff, 0xda, 0x00,
  0x02, 0xff, 0xd9,
]);

describe("media normalization", () => {
  it("denies extension/signature mismatches", () => {
    expect(
      normalizeUploadedMedia({
        bytes: jpegWithExif,
        fileName: "photo.png",
        mimeType: "image/jpeg",
        stripMetadata: true,
        retentionPermitsOriginal: false,
        signatureMatches: true,
      }),
    ).toEqual({ outcome: "denied", code: "file_mime_mismatch" });
  });

  it("strips JPEG EXIF and does not preserve the original unless retention permits", () => {
    const result = normalizeUploadedMedia({
      bytes: jpegWithExif,
      fileName: "photo.jpg",
      mimeType: "image/jpeg",
      stripMetadata: true,
      retentionPermitsOriginal: false,
      signatureMatches: true,
    });
    expect(result.outcome).toBe("accepted");
    if (result.outcome !== "accepted") return;
    expect(result.metadataStripped).toBe(true);
    expect(result.originalPreserved).toBe(false);
    expect(result.bytes).not.toEqual(jpegWithExif);
    expect([...result.bytes.slice(0, 4)]).toEqual([0xff, 0xd8, 0xff, 0xda]);
  });

  it("requests isolated transcode for unbounded gif/webp without claiming coverage", () => {
    const result = normalizeUploadedMedia({
      bytes: new Uint8Array([0x47, 0x49, 0x46]),
      fileName: "loop.gif",
      mimeType: "image/gif",
      stripMetadata: true,
      retentionPermitsOriginal: true,
      signatureMatches: true,
    });
    expect(result).toMatchObject({
      outcome: "accepted",
      transcodeRequested: true,
      originalPreserved: true,
    });
  });
});

import { describe, expect, it, vi } from "vitest";

import {
  completeDirectUploadProtocol,
  validateUploadStreamChunk,
} from "./direct-upload-protocol";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("direct upload protocol", () => {
  it("returns already-ready without reading object bytes", async () => {
    const readBytes = vi.fn(async () => png);
    expect(
      await completeDirectUploadProtocol({
        alreadyReady: true,
        status: "ready",
        isResumable: false,
        headSupported: true,
        declaredSizeBytes: png.byteLength,
        maxBytes: 1024,
        sha256Declared: "abc",
        mimeType: "image/png",
        readBytes,
        sha256Hex: () => "abc",
        assertMime: () => undefined,
      }),
    ).toEqual({ outcome: "already_ready" });
    expect(readBytes).not.toHaveBeenCalled();
  });

  it("HEADs before read and deletes on declared-size mismatch", async () => {
    const readBytes = vi.fn(async () => png);
    expect(
      await completeDirectUploadProtocol({
        alreadyReady: false,
        status: "uploading",
        isResumable: false,
        headSupported: true,
        head: { sizeBytes: 99 },
        declaredSizeBytes: png.byteLength,
        maxBytes: 1024,
        sha256Declared: "abc",
        mimeType: "image/png",
        readBytes,
        sha256Hex: () => "abc",
        assertMime: () => undefined,
      }),
    ).toEqual({
      outcome: "denied",
      code: "file_size_mismatch",
      deleteObject: true,
    });
    expect(readBytes).not.toHaveBeenCalled();
  });

  it("validates streaming bounds before accepting the object", async () => {
    expect(
      validateUploadStreamChunk({
        receivedBytes: 8,
        chunkLength: 8,
        declaredSizeBytes: 16,
        maxBytes: 16,
      }),
    ).toEqual({ outcome: "complete", receivedBytes: 16 });
    expect(
      validateUploadStreamChunk({
        receivedBytes: 8,
        chunkLength: 16,
        declaredSizeBytes: 16,
        maxBytes: 16,
      }),
    ).toEqual({ outcome: "denied", code: "file_size_mismatch" });
  });

  it("accepts a checksummed, signature-checked object after HEAD", async () => {
    const result = await completeDirectUploadProtocol({
      alreadyReady: false,
      status: "uploading",
      isResumable: false,
      headSupported: true,
      head: { sizeBytes: png.byteLength },
      declaredSizeBytes: png.byteLength,
      maxBytes: 1024,
      sha256Declared: "digest",
      mimeType: "image/png",
      readBytes: async () => png,
      sha256Hex: (bytes) => (bytes === png ? "digest" : "nope"),
      assertMime: () => undefined,
    });
    expect(result).toEqual({ outcome: "accepted", bytes: png });
  });
});

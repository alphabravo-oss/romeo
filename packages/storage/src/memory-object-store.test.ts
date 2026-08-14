import { describe, expect, it } from "vitest";

import { MemoryObjectStore } from "./memory-object-store";
import { ObjectSizeLimitError } from "./types";

describe("MemoryObjectStore", () => {
  it("stores, reads, signs, and deletes objects by key", async () => {
    const store = new MemoryObjectStore();
    const bytes = new TextEncoder().encode("romeo storage");

    const stored = await store.putObject({
      key: "knowledge/source.txt",
      body: bytes,
      contentType: "text/plain",
    });
    const read = await store.getObject(stored.key);
    const upload = await store.createPresignedUpload({
      key: stored.key,
      contentType: "text/plain",
      expiresInSeconds: 60,
    });
    await store.deleteObject(stored.key);

    expect(stored.sizeBytes).toBe(bytes.byteLength);
    expect(stored.etag).toMatch(/^[a-f0-9]{64}$/);
    expect(new TextDecoder().decode(read)).toBe("romeo storage");
    expect(upload.url).toBe("memory://object-store/knowledge%2Fsource.txt");
    expect(await store.getObject(stored.key)).toBeUndefined();
  });

  it("reports metadata and refuses reads beyond a caller byte limit", async () => {
    const store = new MemoryObjectStore();
    const bytes = new TextEncoder().encode("bounded object");
    const stored = await store.putObject({
      key: "bounded.txt",
      body: bytes,
      contentType: "text/plain",
    });

    await expect(store.headObject(stored.key)).resolves.toMatchObject({
      key: stored.key,
      sizeBytes: bytes.byteLength,
    });
    await expect(
      store.getObject(stored.key, { maxBytes: bytes.byteLength - 1 }),
    ).rejects.toBeInstanceOf(ObjectSizeLimitError);
  });
});

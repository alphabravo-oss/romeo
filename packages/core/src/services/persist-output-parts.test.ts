import { describe, expect, it, vi } from "vitest";

import {
  extractProviderOutputParts,
  persistProviderOutputParts,
} from "./persist-output-parts";

describe("persist provider output parts", () => {
  it("stores bytes before emitting a lightweight reference event", async () => {
    const order: string[] = [];
    const store = vi.fn(async () => {
      order.push("store");
      return { fileId: "file_image" };
    });
    const persistPart = vi.fn(async () => {
      order.push("persist");
    });
    const emit = vi.fn(() => {
      order.push("emit");
    });
    const result = await persistProviderOutputParts({
      parts: [
        { type: "image", bytes: new Uint8Array([1, 2, 3]), mediaType: "image/png" },
        { type: "citation", citation: { sourceId: "src_1", chunkId: "chk_1" } },
      ],
      store,
      persistPart,
      emit,
    });
    expect(result.persisted).toEqual([
      { type: "image_ref", fileId: "file_image" },
      { type: "citation_ref", sourceId: "src_1", chunkId: "chk_1" },
    ]);
    expect(result.emitted.map((event) => event.partRef)).toEqual(result.persisted);
    expect(JSON.stringify(result.emitted)).not.toContain("1,2,3");
    expect(order).toEqual(["store", "persist", "emit", "persist", "emit"]);
  });

  it("does not emit when storage fails", async () => {
    const emit = vi.fn();
    await expect(
      persistProviderOutputParts({
        parts: [{ type: "audio", bytes: new Uint8Array([9]), mediaType: "audio/mpeg" }],
        store: async () => {
          throw new Error("object store unavailable");
        },
        persistPart: async () => undefined,
        emit,
      }),
    ).rejects.toThrow("object store unavailable");
    expect(emit).not.toHaveBeenCalled();
  });

  it("extracts provider output parts from event data", () => {
    expect(
      extractProviderOutputParts({
        outputParts: [{ type: "artifact", artifact: { artifactId: "art_1", version: "v2" } }],
      }),
    ).toEqual([
      { type: "artifact", artifact: { artifactId: "art_1", version: "v2" } },
    ]);
  });
});

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
        {
          type: "image",
          bytes: new Uint8Array([1, 2, 3]),
          mediaType: "image/png",
        },
        { type: "citation", citation: { sourceId: "src_1", chunkId: "chk_1" } },
      ],
      store,
      persistPart,
      authorizeCitation: async () => ({
        documentId: "src_1",
        title: "Source one",
      }),
      emit,
    });
    expect(result.persisted).toEqual([
      { type: "image_ref", fileId: "file_image", mediaType: "image/png" },
      {
        type: "citation_ref",
        sourceId: "src_1",
        documentId: "src_1",
        chunkId: "chk_1",
        title: "Source one",
      },
    ]);
    expect(result.emitted.map((event) => event.partRef)).toEqual(
      result.persisted,
    );
    expect(JSON.stringify(result.emitted)).not.toContain("1,2,3");
    expect(order).toEqual(["store", "persist", "emit", "persist", "emit"]);
  });

  it("does not emit when storage fails", async () => {
    const emit = vi.fn();
    await expect(
      persistProviderOutputParts({
        parts: [
          {
            type: "audio",
            bytes: new Uint8Array([9]),
            durationMs: 1_000,
            mediaType: "audio/mpeg",
          },
        ],
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
        outputParts: [
          {
            type: "artifact",
            artifact: { artifactId: "art_1", version: "v2" },
          },
        ],
      }),
    ).toEqual([
      { type: "artifact", artifact: { artifactId: "art_1", version: "v2" } },
    ]);
  });

  it("rejects oversized, incomplete, and unauthorized provider references", async () => {
    expect(() =>
      extractProviderOutputParts({
        outputParts: [
          {
            type: "audio",
            bytes: new Uint8Array([0xff, 0xfb]),
            mediaType: "audio/mpeg",
          },
        ],
      }),
    ).toThrow("provider_output_audio_duration_invalid");
    await expect(
      persistProviderOutputParts({
        parts: [
          {
            type: "citation",
            citation: { sourceId: "source_not_retrieved" },
          },
        ],
        authorizeCitation: async () => undefined,
        emit: () => undefined,
        persistPart: async () => undefined,
        store: async () => ({ fileId: "file_never" }),
      }),
    ).rejects.toThrow("provider_output_citation_unauthorized");
    await expect(
      persistProviderOutputParts({
        parts: [
          {
            type: "artifact",
            artifact: { artifactId: "artifact_unregistered", version: "1" },
          },
        ],
        emit: () => undefined,
        persistPart: async () => undefined,
        store: async () => ({ fileId: "file_never" }),
      }),
    ).rejects.toThrow("provider_output_artifact_unauthorized");
  });
});

import { describe, expect, it } from "vitest";

import { isReindexPayloadCoherent } from "./knowledge-reindex";

describe("isReindexPayloadCoherent", () => {
  it("accepts a payload built for the clicked row", () => {
    expect(
      isReindexPayloadCoherent({
        sourceId: "source-a",
        payloadSourceId: "source-a",
      }),
    ).toBe(true);
  });

  it("rejects content associated with another row", () => {
    expect(
      isReindexPayloadCoherent({
        sourceId: "source-a",
        payloadSourceId: "source-b",
      }),
    ).toBe(false);
  });

  it("rejects a payload with no explicit source identity", () => {
    expect(
      isReindexPayloadCoherent({
        sourceId: "source-a",
        payloadSourceId: undefined,
      }),
    ).toBe(false);
  });
});

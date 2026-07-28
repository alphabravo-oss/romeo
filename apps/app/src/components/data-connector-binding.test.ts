import { describe, expect, it } from "vitest";

import { resolveKnowledgeBaseBinding } from "./data-connector-binding";

describe("resolveKnowledgeBaseBinding", () => {
  it("returns the explicitly selected knowledge base", () => {
    expect(
      resolveKnowledgeBaseBinding({
        selectedKnowledgeBaseId: "kb-production",
        availableIds: ["kb-archive", "kb-production"],
      }),
    ).toEqual({ ok: true, knowledgeBaseId: "kb-production" });
  });

  it("never falls back to the first available knowledge base", () => {
    expect(
      resolveKnowledgeBaseBinding({
        selectedKnowledgeBaseId: undefined,
        availableIds: ["kb-archive", "kb-production"],
      }),
    ).toEqual({ ok: false, reason: "none-selected" });
  });

  it("reports that no knowledge bases exist", () => {
    expect(
      resolveKnowledgeBaseBinding({
        selectedKnowledgeBaseId: undefined,
        availableIds: [],
      }),
    ).toEqual({ ok: false, reason: "no-bases" });
  });
});

import { describe, expect, it } from "vitest";

import {
  canInlineUpload,
  isDeferredKnowledgeMime,
  isSupportedKnowledgeMime,
  mimeTypeFor,
  shouldInlineKnowledgeFile,
} from "./knowledge-file-utils";

describe("knowledge file types", () => {
  it("maps Office and PDF extensions even when the browser reports octet-stream", () => {
    expect(mimeTypeFor("policy.pdf", "application/octet-stream")).toBe(
      "application/pdf",
    );
    expect(mimeTypeFor("brief.docx")).toContain("wordprocessingml");
    expect(mimeTypeFor("deck.pptx")).toContain("presentationml");
    expect(mimeTypeFor("budget.xlsx")).toContain("spreadsheetml");
  });

  it("keeps text, data, and markup as inline-extractable", () => {
    expect(canInlineUpload("text/markdown")).toBe(true);
    expect(canInlineUpload("application/json")).toBe(true);
    expect(canInlineUpload("application/xml")).toBe(true);
    expect(canInlineUpload("application/yaml")).toBe(true);
    expect(canInlineUpload("application/pdf")).toBe(false);
  });

  it("treats PDF and Office as deferred extraction types", () => {
    expect(isDeferredKnowledgeMime("application/pdf")).toBe(true);
    expect(
      isDeferredKnowledgeMime(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe(true);
    expect(isSupportedKnowledgeMime("application/pdf")).toBe(true);
    expect(isSupportedKnowledgeMime("image/png")).toBe(true);
    expect(isDeferredKnowledgeMime("image/jpeg")).toBe(true);
    expect(isSupportedKnowledgeMime("audio/mpeg")).toBe(false);
  });

  it("inlines only small text files", () => {
    const small = new File(["hello"], "note.md", { type: "text/markdown" });
    const large = new File([new Uint8Array(200_001)], "big.md", {
      type: "text/markdown",
    });
    expect(shouldInlineKnowledgeFile(small, "text/markdown")).toBe(true);
    expect(shouldInlineKnowledgeFile(large, "text/markdown")).toBe(false);
  });
});

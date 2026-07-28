import { describe, expect, it } from "vitest";

import { resolveSectionKey } from "./section-routing";

const sections = {
  overview: {},
  usage: {},
};

describe("resolveSectionKey", () => {
  it("keeps a known section", () => {
    expect(resolveSectionKey("usage", sections, "overview")).toBe("usage");
  });

  it("falls back for missing and unknown sections", () => {
    expect(resolveSectionKey(undefined, sections, "overview")).toBe("overview");
    expect(resolveSectionKey("models", sections, "overview")).toBe("overview");
  });

  it.each(["constructor", "hasOwnProperty", "toString"])(
    "rejects inherited object key %s",
    (candidate) => {
      expect(resolveSectionKey(candidate, sections, "overview")).toBe(
        "overview",
      );
    },
  );
});

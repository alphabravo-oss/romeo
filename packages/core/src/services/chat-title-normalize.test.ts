import { describe, expect, it } from "vitest";

import { fallbackTitle, normalizeGeneratedTitle } from "./chat-title-normalize";

describe("normalizeGeneratedTitle", () => {
  const fallback = "can i have sample python code";

  it("keeps a clean topical title", () => {
    expect(normalizeGeneratedTitle("Sample Python code", fallback)).toBe(
      "Sample Python code",
    );
  });

  it("rejects fenced language tags as titles", () => {
    expect(normalizeGeneratedTitle("```python", fallback)).toBe(
      "can i have sample python code",
    );
    expect(normalizeGeneratedTitle("```python\nprint(1)\n```", fallback)).toBe(
      "can i have sample python code",
    );
    expect(normalizeGeneratedTitle("python", fallback)).toBe(
      "can i have sample python code",
    );
  });

  it("strips markdown heading and quote wrappers", () => {
    expect(normalizeGeneratedTitle('# "Release plan"', fallback)).toBe(
      "Release plan",
    );
  });

  it("pulls title from JSON when the model wraps it", () => {
    expect(
      normalizeGeneratedTitle('{"title":"Secure rollout plan"}', fallback),
    ).toBe("Secure rollout plan");
  });

  it("falls back when the model returns empty noise", () => {
    expect(normalizeGeneratedTitle("```", fallback)).toBe(
      "can i have sample python code",
    );
    expect(normalizeGeneratedTitle("...", fallback)).toBe(
      "can i have sample python code",
    );
  });
});

describe("fallbackTitle", () => {
  it("uses the first words of the user message", () => {
    expect(fallbackTitle("can i have sample python code please?")).toBe(
      "can i have sample python code",
    );
  });
});

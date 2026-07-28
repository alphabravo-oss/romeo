import { describe, expect, it } from "vitest";

import { resolveActiveSuite } from "./eval-selection";

describe("resolveActiveSuite", () => {
  const first = { id: "first", name: "First" };
  const second = { id: "second", name: "Second" };

  it("uses an explicit selection", () => {
    expect(resolveActiveSuite([first, second], "second")).toBe(second);
  });

  it("falls back to the first suite without a selection", () => {
    expect(resolveActiveSuite([first, second], undefined)).toBe(first);
  });

  it("preserves a selected suite when the list reorders", () => {
    expect(resolveActiveSuite([second, first], "first")).toBe(first);
  });

  it("falls back when the selected row is no longer present", () => {
    expect(resolveActiveSuite([first], "second")).toBe(first);
  });
});

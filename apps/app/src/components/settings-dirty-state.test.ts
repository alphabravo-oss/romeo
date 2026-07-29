import { describe, expect, it } from "vitest";

import { changedFields, isDirty } from "./settings-dirty-state";

describe("settings dirty state", () => {
  it("reports clean when every value matches", () => {
    expect(isDirty({ a: 1, b: "x" }, { a: 1, b: "x" })).toBe(false);
  });

  it("reports dirty when a value changes", () => {
    expect(isDirty({ a: 1, b: "x" }, { a: 2, b: "x" })).toBe(true);
  });

  it("treats an empty string and undefined as different so clearing a field counts", () => {
    expect(isDirty({ a: "x" }, { a: "" })).toBe(true);
  });

  it("lists only the fields that changed", () => {
    expect(
      changedFields({ a: 1, b: "x", c: true }, { a: 2, b: "x", c: false }),
    ).toEqual(["a", "c"]);
  });

  it("compares arrays by content, not identity", () => {
    expect(isDirty({ tiers: ["a", "b"] }, { tiers: ["a", "b"] })).toBe(false);
    expect(isDirty({ tiers: ["a", "b"] }, { tiers: ["b", "a"] })).toBe(true);
  });
});

import { describe, expect, it } from "vitest";

import {
  isSafeRelativeReturnPath,
  normalizeWebOrigin,
  safeRelativeReturnPath,
} from "./navigation";

describe("authentication navigation", () => {
  it("accepts only bounded same-origin application paths", () => {
    expect(isSafeRelativeReturnPath("/admin?section=users#active")).toBe(true);
    expect(isSafeRelativeReturnPath("//attacker.example/path")).toBe(false);
    expect(isSafeRelativeReturnPath("https://attacker.example")).toBe(false);
    expect(isSafeRelativeReturnPath("/admin\r\nlocation: evil")).toBe(false);
    expect(isSafeRelativeReturnPath(`/${"a".repeat(500)}`)).toBe(false);
  });

  it("uses a local fallback for unsafe return paths", () => {
    expect(safeRelativeReturnPath("/settings")).toBe("/settings");
    expect(safeRelativeReturnPath("//attacker.example")).toBe("/");
    expect(safeRelativeReturnPath(undefined, "/login")).toBe("/login");
  });

  it("normalizes configured application origins", () => {
    expect(normalizeWebOrigin("https://romeo.example/app?q=1")).toBe(
      "https://romeo.example",
    );
  });
});

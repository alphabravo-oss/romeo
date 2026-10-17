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

  it("rejects paths that browsers normalise to another origin", () => {
    for (const value of [
      "/\\evil.example",
      "/\\/evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "/ /evil.example",
      "//evil.example",
      "///evil.example",
      "javascript:alert(1)",
      "/\u0000/evil.example",
      "",
    ]) {
      expect({ value, safe: isSafeRelativeReturnPath(value) }).toEqual({
        value,
        safe: false,
      });
    }
  });

  it("keeps encoded backslashes on the application origin", () => {
    expect(isSafeRelativeReturnPath("/%5Cevil.example")).toBe(true);
    expect(new URL("/%5Cevil.example", "https://romeo.example").origin).toBe(
      "https://romeo.example",
    );
  });

  it("accepts application paths with query strings and fragments", () => {
    expect(isSafeRelativeReturnPath("/")).toBe(true);
    expect(isSafeRelativeReturnPath("/chats/abc?tab=files&q=%2F%2Fx#m-1")).toBe(
      true,
    );
    expect(isSafeRelativeReturnPath("/settings?next=//evil.example")).toBe(
      true,
    );
  });

  it("uses a local fallback for unsafe return paths", () => {
    expect(safeRelativeReturnPath("/settings")).toBe("/settings");
    expect(safeRelativeReturnPath("//attacker.example")).toBe("/");
    expect(safeRelativeReturnPath("/\\evil.example")).toBe("/");
    expect(safeRelativeReturnPath(undefined, "/login")).toBe("/login");
  });

  it("normalizes configured application origins", () => {
    expect(normalizeWebOrigin("https://romeo.example/app?q=1")).toBe(
      "https://romeo.example",
    );
  });
});

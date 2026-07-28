import { describe, expect, it } from "vitest";

import { safeReturnTo } from "./auth-navigation";

describe("safeReturnTo", () => {
  it("preserves local paths with search and hash state", () => {
    expect(safeReturnTo("/workspace?tab=files#recent")).toBe(
      "/workspace?tab=files#recent",
    );
  });

  it.each([
    "https://attacker.example",
    "//attacker.example",
    "javascript:alert(1)",
    "workspace",
  ])("rejects non-local return target %s", (value) => {
    expect(safeReturnTo(value)).toBe("/");
  });
});

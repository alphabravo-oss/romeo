import { describe, expect, it } from "vitest";

import { containsPattern, escapeLikeValue } from "./like-pattern";

describe("containsPattern", () => {
  it("wraps ordinary input without altering it", () => {
    expect(containsPattern("report")).toBe("%report%");
  });

  it("escapes wildcards so they match literally", () => {
    expect(containsPattern("100%")).toBe("%100\\%%");
    expect(containsPattern("_")).toBe("%\\_%");
    expect(containsPattern("%")).toBe("%\\%%");
  });

  it("escapes backslash before it can escape the next character", () => {
    // Left unescaped, "\%" would reach the engine as an escaped wildcard and
    // match a literal % instead of the two characters the user typed.
    expect(escapeLikeValue("\\%")).toBe("\\\\\\%");
  });

  it("escapes every occurrence, not just the first", () => {
    expect(escapeLikeValue("%_%_")).toBe("\\%\\_\\%\\_");
  });
});

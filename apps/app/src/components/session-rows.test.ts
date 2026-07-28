import { describe, expect, it } from "vitest";

import { decorateSessions } from "./session-rows";

describe("decorateSessions", () => {
  const sessions = [{ id: "one" }, { id: "two" }, { id: "three" }];

  it("marks exactly the matching row current", () => {
    const rows = decorateSessions(sessions, "two");
    expect(rows.filter((row) => row.current)).toEqual([
      { id: "two", current: true },
    ]);
  });

  it("marks no rows when the current id is unavailable", () => {
    expect(
      decorateSessions(sessions, undefined).some((row) => row.current),
    ).toBe(false);
  });

  it("marks no rows for an unmatched id", () => {
    expect(
      decorateSessions(sessions, "missing").some((row) => row.current),
    ).toBe(false);
  });
});

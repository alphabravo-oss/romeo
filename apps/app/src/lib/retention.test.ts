import { describe, expect, it } from "vitest";

import {
  formatRetentionOverrides,
  parseOptionalRetentionDays,
  parseRetentionOverrides,
} from "./retention";

describe("retention policy form values", () => {
  it("round-trips finite and indefinite scoped overrides", () => {
    const overrides = { workspace_b: null, workspace_a: 90 };

    expect(formatRetentionOverrides(overrides)).toBe(
      "workspace_a=90\nworkspace_b=forever",
    );
    expect(
      parseRetentionOverrides(formatRetentionOverrides(overrides)),
    ).toEqual(overrides);
  });

  it("uses a blank organization value for indefinite retention", () => {
    expect(parseOptionalRetentionDays("  ")).toBeNull();
    expect(parseOptionalRetentionDays("365")).toBe(365);
  });

  it("rejects malformed, duplicate, and out-of-range overrides", () => {
    expect(() => parseRetentionOverrides("missing-value")).toThrow(
      "needs a valid ID",
    );
    expect(() => parseRetentionOverrides("user_a=30\nuser_a=60")).toThrow(
      "duplicated",
    );
    expect(() => parseRetentionOverrides("user_a=0")).toThrow("1-3650");
  });
});

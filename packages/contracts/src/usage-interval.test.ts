import { describe, expect, it } from "vitest";

import { UsageIntervalSchema } from "./operational-governance";

describe("UsageIntervalSchema", () => {
  it("accepts UTC and explicit-offset instants across a DST transition", () => {
    expect(
      UsageIntervalSchema.safeParse({
        from: "2026-03-08T03:00:00.000-04:00",
        to: "2026-03-08T04:00:00.000-04:00",
      }).success,
    ).toBe(true);
    expect(
      UsageIntervalSchema.safeParse({
        from: "2026-03-08T07:00:00.000Z",
        to: "2026-03-08T08:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("rejects malformed, empty, and reversed intervals", () => {
    expect(
      UsageIntervalSchema.safeParse({
        from: "not-a-date",
        to: "2026-08-23T00:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      UsageIntervalSchema.safeParse({
        from: "2026-08-23T00:00:00.000Z",
        to: "2026-08-23T00:00:00.000Z",
      }).success,
    ).toBe(false);
    expect(
      UsageIntervalSchema.safeParse({
        from: "2026-08-24T00:00:00.000Z",
        to: "2026-08-23T00:00:00.000Z",
      }).success,
    ).toBe(false);
  });
});

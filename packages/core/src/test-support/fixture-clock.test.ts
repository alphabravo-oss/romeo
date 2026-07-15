import { describe, expect, it } from "vitest";

import { fixtureFuture, fixturePast } from "./fixture-clock";

describe("fixture clock", () => {
  it("returns an ISO timestamp in the future", () => {
    expect(new Date(fixtureFuture()).getTime()).toBeGreaterThan(Date.now());
  });

  it("returns an ISO timestamp in the past", () => {
    expect(new Date(fixturePast()).getTime()).toBeLessThan(Date.now());
  });

  it("honours an explicit offset", () => {
    const oneHour = 60 * 60 * 1000;
    const actual = new Date(fixtureFuture(oneHour)).getTime();
    expect(actual).toBeGreaterThan(Date.now() + oneHour - 5_000);
    expect(actual).toBeLessThan(Date.now() + oneHour + 5_000);
  });
});

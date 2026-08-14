import { describe, expect, it } from "vitest";

import { rangeToBounds, RANGE_PRESETS } from "./date-range";

const NOW = new Date("2026-07-29T12:00:00.000Z");

describe("date range", () => {
  it("resolves 24 hours back from the reference instant", () => {
    const bounds = rangeToBounds("24h", NOW);
    expect(bounds.to.toISOString()).toBe("2026-07-29T12:00:00.000Z");
    expect(bounds.from?.toISOString()).toBe("2026-07-28T12:00:00.000Z");
  });

  it("resolves 7 days", () => {
    expect(rangeToBounds("7d", NOW).from?.toISOString()).toBe(
      "2026-07-22T12:00:00.000Z",
    );
  });

  it("resolves 30 days", () => {
    expect(rangeToBounds("30d", NOW).from?.toISOString()).toBe(
      "2026-06-29T12:00:00.000Z",
    );
  });

  it("returns an open lower bound for all time", () => {
    expect(rangeToBounds("all", NOW).from).toBeUndefined();
  });

  it("exposes every preset the select renders", () => {
    expect(RANGE_PRESETS).toEqual(["24h", "7d", "30d", "90d", "all"]);
  });

  // Callers embed these bounds in a react-query key. An unquantised instant
  // makes the key change on every render, which turned the audit page into a
  // ~150 req/s refetch loop that never rendered a row.
  it("floors bounds to the minute so a query key is stable within one", () => {
    const a = rangeToBounds("7d", new Date("2026-07-29T12:00:00.123Z"));
    const b = rangeToBounds("7d", new Date("2026-07-29T12:00:59.987Z"));
    expect(a.to.toISOString()).toBe("2026-07-29T12:00:00.000Z");
    expect(a.to.getTime()).toBe(b.to.getTime());
    expect(a.from?.getTime()).toBe(b.from?.getTime());
  });

  it("floors the open-ended range too", () => {
    expect(
      rangeToBounds(
        "all",
        new Date("2026-07-29T12:00:33.500Z"),
      ).to.toISOString(),
    ).toBe("2026-07-29T12:00:00.000Z");
  });
});

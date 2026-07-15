import { describe, expect, it, vi } from "vitest";

import { activeChatLegalHold } from "./data-deletion-repository";

describe("data deletion repository helpers", () => {
  it("maps active legal holds and drops expired holds", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-27T00:00:00.000Z"));

    expect(
      activeChatLegalHold({
        legalHoldUntil: new Date("2026-07-01T00:00:00.000Z"),
        legalHoldReason: "investigation",
      }),
    ).toEqual({
      until: "2026-07-01T00:00:00.000Z",
      reason: "investigation",
    });
    expect(
      activeChatLegalHold({
        legalHoldUntil: new Date("2026-06-26T00:00:00.000Z"),
        legalHoldReason: "expired",
      }),
    ).toBeUndefined();

    vi.useRealTimers();
  });
});

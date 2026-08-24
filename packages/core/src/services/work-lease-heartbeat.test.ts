import { describe, expect, it, vi } from "vitest";

import { startWorkLeaseHeartbeat } from "./work-lease-heartbeat";

describe("work lease heartbeat", () => {
  it("renews from the injected clock and reports a lost fence", async () => {
    const renew = vi
      .fn<
        (input: { leaseExpiresAt: string; now: string }) => Promise<boolean>
      >()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const clock = vi
      .fn<() => Date>()
      .mockReturnValueOnce(new Date("2026-08-23T12:00:30.000Z"))
      .mockReturnValueOnce(new Date("2026-08-23T12:01:00.000Z"));
    const heartbeat = startWorkLeaseHeartbeat({
      heartbeatIntervalMs: 60_000,
      leaseDurationMs: 300_000,
      lostError: () => new Error("lease_lost"),
      now: clock,
      renew,
    });

    await heartbeat.pulse();
    expect(renew).toHaveBeenNthCalledWith(1, {
      now: "2026-08-23T12:00:30.000Z",
      leaseExpiresAt: "2026-08-23T12:05:30.000Z",
    });
    heartbeat.assertOwned();
    await heartbeat.pulse();
    expect(() => heartbeat.assertOwned()).toThrowError("lease_lost");
    await heartbeat.stop({ requireOwned: false });
  });

  it("fails closed when renewal transport errors", async () => {
    const heartbeat = startWorkLeaseHeartbeat({
      heartbeatIntervalMs: 60_000,
      leaseDurationMs: 300_000,
      lostError: () => new Error("lease_lost"),
      renew: async () => {
        throw new Error("database_unavailable");
      },
    });

    await heartbeat.pulse();
    await expect(heartbeat.stop()).rejects.toThrowError("lease_lost");
  });
});

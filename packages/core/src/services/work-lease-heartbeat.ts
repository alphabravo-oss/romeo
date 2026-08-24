export interface WorkLeaseHeartbeat {
  assertOwned(): void;
  pulse(): Promise<void>;
  stop(options?: { requireOwned?: boolean }): Promise<void>;
}

export function startWorkLeaseHeartbeat(input: {
  heartbeatIntervalMs?: number;
  leaseDurationMs: number;
  lostError: () => Error;
  now?: () => Date;
  renew: (input: { leaseExpiresAt: string; now: string }) => Promise<boolean>;
}): WorkLeaseHeartbeat {
  const now = input.now ?? (() => new Date());
  let active = true;
  let lost = false;
  let renewal = Promise.resolve();
  const pulse = (): Promise<void> => {
    if (!active || lost) return renewal;
    renewal = renewal.then(async () => {
      if (!active || lost) return;
      const renewedAt = now();
      try {
        lost = !(await input.renew({
          now: renewedAt.toISOString(),
          leaseExpiresAt: new Date(
            renewedAt.getTime() + input.leaseDurationMs,
          ).toISOString(),
        }));
      } catch {
        lost = true;
      }
    });
    return renewal;
  };
  const interval = setInterval(
    () => void pulse(),
    input.heartbeatIntervalMs ?? Math.max(1_000, input.leaseDurationMs / 3),
  );
  interval.unref?.();
  return {
    assertOwned() {
      if (lost) throw input.lostError();
    },
    pulse,
    async stop(options = {}) {
      active = false;
      clearInterval(interval);
      await renewal;
      if (options.requireOwned !== false && lost) throw input.lostError();
    },
  };
}

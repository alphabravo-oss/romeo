export interface WorkerLeaseHeartbeat {
  stop(options?: { requireOwned?: boolean }): Promise<void>;
}

export function startWorkerLeaseHeartbeat(input: {
  leaseSeconds: number;
  renew: () => Promise<unknown>;
}): WorkerLeaseHeartbeat {
  let active = true;
  let failure: unknown;
  let inFlight: Promise<void> | undefined;
  const intervalMs = Math.max(
    1_000,
    Math.floor((input.leaseSeconds * 1_000) / 3),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = () => {
    if (!active) return;
    timer = setTimeout(() => {
      if (!active) return;
      inFlight = input
        .renew()
        .then(() => {
          if (active) schedule();
        })
        .catch((error: unknown) => {
          failure = error;
          active = false;
        });
    }, intervalMs);
  };
  schedule();

  return {
    async stop(options = {}) {
      active = false;
      if (timer !== undefined) clearTimeout(timer);
      await inFlight;
      if (failure !== undefined && options.requireOwned !== false)
        throw failure;
    },
  };
}

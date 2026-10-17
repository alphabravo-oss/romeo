import type { BackgroundJob } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";

/**
 * Renews the run execution job lease on an interval. A lost or failed renewal
 * calls `onLost` so streaming aborts. Returns a function that stops renewals.
 */
export function startRunExecutionHeartbeat(input: {
  currentJob: () => BackgroundJob;
  intervalMs: number;
  leaseSeconds: number;
  onLost: () => void;
  onRenewed: (job: BackgroundJob) => void;
  orgId: string;
  repository: RomeoRepository;
  workerId: string;
}): () => void {
  const timer = setInterval(() => {
    void input.repository
      .renewBackgroundJobLease({
        orgId: input.orgId,
        jobId: input.currentJob().id,
        workerId: input.workerId,
        leaseSeconds: input.leaseSeconds,
      })
      .then((renewed) => {
        if (renewed === undefined) input.onLost();
        else input.onRenewed(renewed);
      })
      .catch(() => input.onLost());
  }, input.intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

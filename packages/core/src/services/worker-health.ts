import { channel } from "node:diagnostics_channel";

export type WorkerHealthState = "backoff" | "idle" | "running" | "stopped";

export interface WorkerHealthSnapshot {
  worker: string;
  state: WorkerHealthState;
  running: boolean;
  consecutiveFailures: number;
  iterationCount: number;
  successCount: number;
  failureCount: number;
  skippedOverlapCount: number;
  leaseClaimCount: number;
  leaseMissCount: number;
  scheduleLagMs: number;
  leaseLagMs: number;
  lastStartedAt?: string;
  lastCompletedAt?: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  nextRunAt?: string | undefined;
}

export const workerHealthChannel = channel("romeo.worker.health");
const snapshots = new Map<string, WorkerHealthSnapshot>();

export function publishWorkerHealth(snapshot: WorkerHealthSnapshot): void {
  const safe = { ...snapshot };
  snapshots.set(snapshot.worker, safe);
  workerHealthChannel.publish(safe);
}

export function listWorkerHealthSnapshots(): WorkerHealthSnapshot[] {
  return [...snapshots.values()]
    .map((snapshot) => ({ ...snapshot }))
    .sort((left, right) => left.worker.localeCompare(right.worker));
}

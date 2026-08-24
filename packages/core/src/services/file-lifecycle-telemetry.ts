import { channel } from "node:diagnostics_channel";

import type { FileObjectStatus } from "../domain/entities";

type FileLifecycleWorkerOutcome =
  | "completed"
  | "failed"
  | "idle"
  | "lease_lost"
  | "rejected";

export interface FileLifecycleWorkerMetric {
  attempt: number;
  durationMs: number;
  outcome: FileLifecycleWorkerOutcome;
  queueAgeSeconds: number;
  state: FileObjectStatus;
}

export const fileLifecycleWorkerChannel = channel("romeo.file.lifecycle");

export function publishFileLifecycleWorkerMetric(
  metric: FileLifecycleWorkerMetric,
): void {
  fileLifecycleWorkerChannel.publish(Object.freeze({ ...metric }));
}

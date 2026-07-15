import type { NotificationRetryResult } from "@romeo/api-client";

import type { CliIo } from "./io";
import { writeJson } from "./io";
import { workerSignalAborted } from "./worker-control";

export interface NotificationRetryWorkerClient {
  notifications: {
    retryDue(): Promise<NotificationRetryResult>;
  };
}

export interface RunNotificationRetryWorkerInput {
  client: NotificationRetryWorkerClient;
  intervalMs: number;
  io: CliIo;
  maxIterations?: number;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
}

export async function runNotificationRetryWorker(
  input: RunNotificationRetryWorkerInput,
): Promise<number> {
  const sleep = input.sleep ?? sleepMs;
  let iteration = 0;

  while (!workerSignalAborted(input.signal)) {
    iteration += 1;
    const result = await input.client.notifications.retryDue();
    writeRetryResult(input.io, iteration, result);

    if (input.maxIterations !== undefined && iteration >= input.maxIterations)
      return 0;
    if (workerSignalAborted(input.signal)) return 0;
    await sleep(input.intervalMs);
  }

  return 0;
}

function writeRetryResult(
  io: CliIo,
  iteration: number,
  result: NotificationRetryResult,
): void {
  writeJson(io, {
    iteration,
    retriedDeliveryCount: result.deliveries.length,
    job: result.job,
    deliveries: result.deliveries,
  });
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

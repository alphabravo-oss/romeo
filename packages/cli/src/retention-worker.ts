import type { RetentionEnforcementResult } from "@romeo/api-client";

import type { CliIo } from "./io";
import { writeJson } from "./io";
import { workerSignalAborted } from "./worker-control";

export interface RetentionEnforcementWorkerClient {
  governance: {
    enforceRetention(): Promise<RetentionEnforcementResult>;
  };
}

export interface RunRetentionEnforcementWorkerInput {
  client: RetentionEnforcementWorkerClient;
  intervalMs: number;
  io: CliIo;
  maxIterations?: number;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
}

export async function runRetentionEnforcementWorker(
  input: RunRetentionEnforcementWorkerInput,
): Promise<number> {
  const sleep = input.sleep ?? sleepMs;
  let iteration = 0;

  while (!workerSignalAborted(input.signal)) {
    iteration += 1;
    const result = await input.client.governance.enforceRetention();
    writeJson(input.io, {
      iteration,
      deletedBrowserAutomationArtifactCount:
        result.deletedBrowserAutomationArtifactCount ?? 0,
      deletedAuditLogCount: result.deletedAuditLogCount,
      result,
    });

    if (input.maxIterations !== undefined && iteration >= input.maxIterations)
      return 0;
    if (workerSignalAborted(input.signal)) return 0;
    await sleep(input.intervalMs);
  }

  return 0;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

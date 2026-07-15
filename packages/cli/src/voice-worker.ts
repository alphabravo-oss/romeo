import type { VoiceCatalogSyncResult } from "@romeo/api-client";

import type { CliIo } from "./io";
import { writeJson } from "./io";
import { workerSignalAborted } from "./worker-control";

export interface VoiceCatalogSyncWorkerClient {
  voice: {
    sync(): Promise<VoiceCatalogSyncResult>;
  };
}

export interface RunVoiceCatalogSyncWorkerInput {
  client: VoiceCatalogSyncWorkerClient;
  intervalMs: number;
  io: CliIo;
  maxIterations?: number;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
}

export async function runVoiceCatalogSyncWorker(
  input: RunVoiceCatalogSyncWorkerInput,
): Promise<number> {
  const sleep = input.sleep ?? sleepMs;
  let iteration = 0;

  while (!workerSignalAborted(input.signal)) {
    iteration += 1;
    const result = await input.client.voice.sync();
    writeJson(input.io, {
      iteration,
      imported: result.imported,
      existing: result.existing,
      providerVoiceCount: result.providerVoiceCount,
      profiles: result.profiles,
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

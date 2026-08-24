import type { CliIo } from "./io";
import { writeJson } from "./io";
import { workerSignalAborted } from "./worker-control";

export interface KnowledgeExtractionWorkerClient {
  claimExtraction(input: { leaseSeconds: number }): Promise<{
    claimed: boolean;
    source?: { id?: string } & Record<string, unknown>;
  }>;
  completeExtraction(input: {
    errorCode?: string;
    sourceId: string;
    success: boolean;
  }): Promise<unknown>;
}

export interface RunKnowledgeExtractionWorkerInput {
  client: KnowledgeExtractionWorkerClient;
  intervalMs: number;
  io: CliIo;
  leaseSeconds?: number;
  maxIterations?: number;
  maxSourcesPerIteration?: number;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
}

export async function runKnowledgeExtractionWorker(
  input: RunKnowledgeExtractionWorkerInput,
): Promise<number> {
  const sleep = input.sleep ?? sleepMs;
  let iteration = 0;

  while (!workerSignalAborted(input.signal)) {
    iteration += 1;
    const results: unknown[] = [];
    const errors: Array<{ error: string; sourceId: string }> = [];
    const maximum = input.maxSourcesPerIteration ?? 10;
    let claimedCount = 0;
    for (let index = 0; index < maximum; index += 1) {
      if (workerSignalAborted(input.signal)) break;
      const claim = await input.client.claimExtraction({
        leaseSeconds: input.leaseSeconds ?? 300,
      });
      if (!claim.claimed) break;
      const sourceId = claim.source?.id;
      if (sourceId === undefined)
        throw new Error("worker_broker_claim_invalid");
      claimedCount += 1;
      try {
        results.push(
          await input.client.completeExtraction({ sourceId, success: true }),
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown extraction error.";
        errors.push({ error: message, sourceId });
        try {
          await input.client.completeExtraction({
            errorCode: "knowledge_extraction_failed",
            sourceId,
            success: false,
          });
        } catch {
          // The first completion may have consumed or lost the fenced claim.
        }
      }
    }

    writeJson(input.io, {
      iteration,
      claimedCount,
      extractedCount: results.length,
      failedCount: errors.length,
      results,
      errors,
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

import type {
  KnowledgeExtractionJobResult,
  KnowledgeSource,
} from "@romeo/api-client";

import type { CliIo } from "./io";
import { writeJson } from "./io";
import { workerSignalAborted } from "./worker-control";

export interface KnowledgeExtractionWorkerClient {
  knowledge: {
    extractUpload(
      knowledgeBaseId: string,
      sourceId: string,
    ): Promise<KnowledgeExtractionJobResult>;
    listSources(knowledgeBaseId: string): Promise<KnowledgeSource[]>;
  };
}

export interface RunKnowledgeExtractionWorkerInput {
  client: KnowledgeExtractionWorkerClient;
  intervalMs: number;
  io: CliIo;
  knowledgeBaseId: string;
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
    const sources = await input.client.knowledge.listSources(
      input.knowledgeBaseId,
    );
    const pending = sources
      .filter(
        (source) =>
          source.status === "pending" && source.objectKey !== undefined,
      )
      .slice(0, input.maxSourcesPerIteration ?? 10);
    const results: KnowledgeExtractionJobResult[] = [];
    const errors: Array<{ error: string; sourceId: string }> = [];

    for (const source of pending) {
      try {
        results.push(
          await input.client.knowledge.extractUpload(
            input.knowledgeBaseId,
            source.id,
          ),
        );
      } catch (error) {
        errors.push({
          sourceId: source.id,
          error:
            error instanceof Error
              ? error.message
              : "Unknown extraction error.",
        });
      }
    }

    writeJson(input.io, {
      iteration,
      pendingCount: pending.length,
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

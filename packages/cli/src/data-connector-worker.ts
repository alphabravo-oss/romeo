import type {
  DataConnector,
  DataConnectorSync,
  SyncDataConnectorInput,
} from "@romeo/api-client";

import type { CliIo } from "./io";
import { writeJson } from "./io";
import { workerSignalAborted } from "./worker-control";

export interface DataConnectorSyncWorkerClient {
  dataConnectors: {
    list(workspaceId?: string): Promise<DataConnector[]>;
    sync(input: SyncDataConnectorInput): Promise<DataConnectorSync>;
  };
}

export interface RunDataConnectorSyncWorkerInput {
  client: DataConnectorSyncWorkerClient;
  intervalMs: number;
  io: CliIo;
  maxConnectorsPerIteration?: number;
  maxIterations?: number;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  workspaceId?: string;
}

export async function runDataConnectorSyncWorker(
  input: RunDataConnectorSyncWorkerInput,
): Promise<number> {
  const sleep = input.sleep ?? sleepMs;
  let iteration = 0;

  while (!workerSignalAborted(input.signal)) {
    iteration += 1;
    const now = new Date().toISOString();
    const connectors = await input.client.dataConnectors.list(
      input.workspaceId,
    );
    const candidates = connectors
      .filter(
        (connector) =>
          connector.status === "active" &&
          connector.type !== "local_import" &&
          connectorSyncIsDue(connector, now),
      )
      .slice(0, input.maxConnectorsPerIteration ?? 10);
    const syncs: DataConnectorSync[] = [];
    const errors: Array<{ connectorId: string; error: string }> = [];

    for (const connector of candidates) {
      try {
        syncs.push(
          await input.client.dataConnectors.sync({ connectorId: connector.id }),
        );
      } catch (error) {
        errors.push({
          connectorId: connector.id,
          error:
            error instanceof Error
              ? error.message
              : "Unknown connector sync error.",
        });
      }
    }

    writeJson(input.io, {
      iteration,
      candidateCount: candidates.length,
      syncedCount: syncs.length,
      failedCount: errors.length,
      syncs,
      errors,
    });

    if (input.maxIterations !== undefined && iteration >= input.maxIterations)
      return 0;
    if (workerSignalAborted(input.signal)) return 0;
    await sleep(input.intervalMs);
  }

  return 0;
}

function connectorSyncIsDue(connector: DataConnector, now: string): boolean {
  return connector.nextSyncAt === undefined || connector.nextSyncAt <= now;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

import type { RunEvent } from "@romeo/ai-runtime";

import type {
  RomeoRepository,
  RomeoRepositoryRuntime,
} from "../domain/repository";
import { createSeedData, type SeedData } from "./seed-data";

export abstract class InMemoryRepositoryBase {
  readonly runtime: RomeoRepositoryRuntime = {
    driver: "memory",
    durable: false,
    storageScope: "process",
    description:
      "Process-local in-memory repository for tests and development.",
  };

  protected readonly data: SeedData;
  protected readonly delegatedOAuthRefreshLocks = new Map<
    string,
    Promise<void>
  >();
  protected readonly runEvents = new Map<string, RunEvent[]>();

  constructor(seed: SeedData = createSeedData()) {
    this.data = seed;
  }

  async transaction<T>(
    work: (repository: RomeoRepository) => Promise<T>,
  ): Promise<T> {
    const dataSnapshot = structuredClone(this.data);
    const runEventsSnapshot = new Map(
      Array.from(this.runEvents.entries()).map(([runId, events]) => [
        runId,
        structuredClone(events),
      ]),
    );
    try {
      return await work(this as unknown as RomeoRepository);
    } catch (error) {
      restoreSeedData(this.data, dataSnapshot);
      this.runEvents.clear();
      for (const [runId, events] of runEventsSnapshot)
        this.runEvents.set(runId, events);
      throw error;
    }
  }
}

function restoreSeedData(target: SeedData, snapshot: SeedData): void {
  for (const key of Object.keys(snapshot) as Array<keyof SeedData>)
    target[key] = snapshot[key] as never;
}

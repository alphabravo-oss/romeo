import {
  publicRunEvent,
  type RunEvent,
  type RunEventType,
} from "@romeo/ai-runtime";
import { channel } from "node:diagnostics_channel";

import type { RomeoRepository } from "../domain/repository";
import {
  InMemoryRunEventTransport,
  type RunEventNotice,
  type RunEventTransport,
} from "./run-event-transport";

const runEventTransportChannel = channel("romeo.run-event-transport");

export class RunEventSequencer {
  constructor(
    private readonly transport: RunEventTransport = new InMemoryRunEventTransport(),
  ) {}

  async assign(
    repository: RomeoRepository,
    event: RunEvent,
  ): Promise<RunEvent> {
    const sequence = await this.next(repository, event.runId);
    return publicRunEvent({
      ...event,
      id: `evt_${event.runId}_${sequence}`,
      sequence,
      schemaVersion: 1,
    });
  }

  async create(
    repository: RomeoRepository,
    input: { runId: string; type: RunEventType; data: Record<string, unknown> },
  ): Promise<RunEvent> {
    const sequence = await this.next(repository, input.runId);
    return publicRunEvent({
      id: `evt_${input.runId}_${sequence}`,
      runId: input.runId,
      sequence,
      schemaVersion: 1,
      type: input.type,
      data: input.data,
      createdAt: new Date().toISOString(),
    });
  }

  async append(repository: RomeoRepository, events: RunEvent[]): Promise<void> {
    if (events.length === 0) return;
    await this.persist(repository, events);
    await this.notify(events);
  }

  /** Persist events as part of the caller's current transaction. */
  persist(repository: RomeoRepository, events: RunEvent[]): Promise<void> {
    if (events.length === 0) return Promise.resolve();
    return repository.appendRunEvents(events.map(publicRunEvent));
  }

  /** Publish metadata-only wakeups after the transaction that persisted the events commits. */
  async notify(events: RunEvent[]): Promise<void> {
    if (events.length === 0) return;
    const latestByRun = new Map<string, number>();
    for (const event of events) {
      latestByRun.set(
        event.runId,
        Math.max(latestByRun.get(event.runId) ?? 0, event.sequence),
      );
    }
    await Promise.all(
      Array.from(latestByRun, ([runId, sequence]) =>
        this.publishBestEffort({ runId, sequence }),
      ),
    );
  }

  subscribe(
    runId: string,
    handler: (notice: RunEventNotice) => void,
  ): Promise<() => void> {
    return this.transport.subscribe(runId, handler);
  }

  close(): void {
    this.transport.close?.();
  }

  private async next(
    repository: RomeoRepository,
    runId: string,
  ): Promise<number> {
    const next = await repository.allocateRunEventSequence(runId);
    if (next === undefined) {
      throw new Error("Cannot allocate an event sequence for an unknown run.");
    }
    return next;
  }

  private async publishBestEffort(notice: RunEventNotice): Promise<void> {
    try {
      await this.transport.publish(notice);
    } catch {
      runEventTransportChannel.publish({
        operation: "publish",
        outcome: "failed",
        sequence: notice.sequence,
      });
    }
  }
}

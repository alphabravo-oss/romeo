import { describe, expect, it, vi } from "vitest";

import type { RunRecord } from "../domain/entities";
import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { replayRunEvents } from "./run-events";
import { RunEventSequencer } from "./run-event-sequencer";
import {
  InMemoryRunEventTransport,
  type RunEventTransport,
} from "./run-event-transport";

describe("run event delivery", () => {
  it("allocates unique sequences across independent sequencers", async () => {
    const repository = await repositoryWithRun();
    const [first, second] = await Promise.all([
      new RunEventSequencer().create(repository, {
        runId: run.id,
        type: "run.started",
        data: {},
      }),
      new RunEventSequencer().create(repository, {
        runId: run.id,
        type: "message.started",
        data: {},
      }),
    ]);

    expect([first.sequence, second.sequence].sort()).toEqual([1, 2]);
    expect(new Set([first.id, second.id]).size).toBe(2);
  });

  it("uses bounded cursor reads and wakes on a live notification", async () => {
    const repository = await repositoryWithRun();
    const fullHistory = vi.spyOn(repository, "listRunEvents");
    const cursorReads = vi.spyOn(repository, "listRunEventsAfter");
    const sequencer = new RunEventSequencer(new InMemoryRunEventTransport());
    const iterator = replayRunEvents(repository, sequencer, run.id, 0, {
      fallbackPollMs: 5_000,
      pageSize: 8,
    })[Symbol.asyncIterator]();
    const next = iterator.next();
    await Promise.resolve();
    const completed = await sequencer.create(repository, {
      runId: run.id,
      type: "run.completed",
      data: { status: "completed" },
    });
    await sequencer.append(repository, [completed]);

    await expect(next).resolves.toEqual({ done: false, value: completed });
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    expect(fullHistory).not.toHaveBeenCalled();
    expect(cursorReads).toHaveBeenCalledWith(run.id, 0, 8, undefined);
  });

  it("publishes only after a successful event transaction commits", async () => {
    const repository = await repositoryWithRun();
    const notices: Array<{ runId: string; sequence: number }> = [];
    const transport: RunEventTransport = {
      async publish(notice) {
        notices.push(notice);
      },
      async subscribe() {
        return () => undefined;
      },
    };
    const sequencer = new RunEventSequencer(transport);
    const committed = await repository.transaction(async (transaction) => {
      const event = await sequencer.create(transaction, {
        runId: run.id,
        type: "message.started",
        data: {},
      });
      await sequencer.persist(transaction, [event]);
      expect(notices).toEqual([]);
      return event;
    });

    expect(notices).toEqual([]);
    await sequencer.notify([committed]);
    expect(notices).toEqual([{ runId: run.id, sequence: committed.sequence }]);

    await expect(
      repository.transaction(async (transaction) => {
        const rolledBack = await sequencer.create(transaction, {
          runId: run.id,
          type: "message.delta",
          data: { delta: "not durable" },
        });
        await sequencer.persist(transaction, [rolledBack]);
        throw new Error("rollback after event persistence");
      }),
    ).rejects.toThrow("rollback after event persistence");
    expect(notices).toHaveLength(1);
    expect(await repository.listRunEvents(run.id)).toEqual([committed]);
  });

  it("falls back to bounded cursor polling when subscribe is unavailable", async () => {
    const repository = await repositoryWithRun();
    const transport: RunEventTransport = {
      async publish() {},
      async subscribe() {
        throw new Error("notification unavailable");
      },
    };
    const sequencer = new RunEventSequencer(transport);
    const iterator = replayRunEvents(repository, sequencer, run.id, 0, {
      fallbackPollMs: 10,
    })[Symbol.asyncIterator]();
    const next = iterator.next();
    const completed = await sequencer.create(repository, {
      runId: run.id,
      type: "run.completed",
      data: {},
    });
    await repository.appendRunEvents([completed]);

    await expect(next).resolves.toEqual({ done: false, value: completed });
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });

  it("stops waiting and unsubscribes when aborted", async () => {
    const repository = await repositoryWithRun();
    const transport = new InMemoryRunEventTransport();
    const unsubscribe = vi.fn();
    const subscribe = vi
      .spyOn(transport, "subscribe")
      .mockResolvedValue(unsubscribe);
    const sequencer = new RunEventSequencer(transport);
    const controller = new AbortController();
    const iterator = replayRunEvents(repository, sequencer, run.id, 0, {
      fallbackPollMs: 60_000,
      signal: controller.signal,
    })[Symbol.asyncIterator]();
    const next = iterator.next();
    await Promise.resolve();

    controller.abort();

    await expect(next).resolves.toEqual({ done: true, value: undefined });
    expect(subscribe).toHaveBeenCalledWith(run.id, expect.any(Function));
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("propagates abort to an in-flight repository query", async () => {
    const repository = await repositoryWithRun();
    const transport = new InMemoryRunEventTransport();
    const sequencer = new RunEventSequencer(transport);
    const controller = new AbortController();
    let notifyQueryStarted!: () => void;
    const queryStarted = new Promise<void>((resolve) => {
      notifyQueryStarted = resolve;
    });
    const query = vi
      .spyOn(repository, "listRunEventsAfter")
      .mockImplementation(async (_runId, _cursor, _limit, signal) => {
        notifyQueryStarted();
        await new Promise<void>((_resolve, reject) => {
          const abort = () => reject(signal?.reason);
          signal?.addEventListener("abort", abort, { once: true });
        });
        return [];
      });
    const iterator = replayRunEvents(repository, sequencer, run.id, 0, {
      fallbackPollMs: 60_000,
      signal: controller.signal,
    })[Symbol.asyncIterator]();
    const next = iterator.next();
    await queryStarted;

    controller.abort();

    await expect(next).resolves.toEqual({ done: true, value: undefined });
    expect(query).toHaveBeenCalledWith(run.id, 0, 256, controller.signal);
  });
});

const run: RunRecord = {
  id: "run_event_delivery",
  orgId: "org_default",
  workspaceId: "workspace_default",
  chatId: "chat_event_delivery",
  agentId: "agent_event_delivery",
  agentVersionId: "agent_version_event_delivery",
  modelId: "model_event_delivery",
  providerId: "provider_event_delivery",
  status: "running",
  createdBy: "user_dev_admin",
  createdAt: "2026-08-13T12:00:00.000Z",
};

async function repositoryWithRun(): Promise<InMemoryRomeoRepository> {
  const repository = new InMemoryRomeoRepository();
  await repository.createRun(run);
  return repository;
}

import type { RunEvent } from "@romeo/ai-runtime";

import type { RomeoRepository } from "../domain/repository";

export const terminalRunEvents = new Set<RunEvent["type"]>([
  "run.cancelled",
  "run.completed",
  "run.failed",
]);
export const suspendedRunEvents = new Set<RunEvent["type"]>([
  "run.waiting_tool_approval",
  "run.waiting_tool_dispatch",
]);

export class ActiveRunControllers {
  private readonly controllers = new Map<string, AbortController>();

  create(runId: string): AbortController {
    const controller = new AbortController();
    this.controllers.set(runId, controller);
    return controller;
  }

  abort(runId: string): void {
    this.controllers.get(runId)?.abort();
  }

  has(runId: string): boolean {
    return this.controllers.has(runId);
  }

  delete(runId: string): void {
    this.controllers.delete(runId);
  }
}

export async function* replayRunEvents(
  repository: RomeoRepository,
  runId: string,
  afterSequence = 0,
): AsyncIterable<RunEvent> {
  let cursor = afterSequence;

  while (true) {
    const events = await repository.listRunEvents(runId);
    const pending = events.filter((event) => event.sequence > cursor);

    for (const event of pending) {
      cursor = Math.max(cursor, event.sequence);
      yield event;
    }

    if (
      pending.some(
        (event) =>
          terminalRunEvents.has(event.type) ||
          suspendedRunEvents.has(event.type),
      )
    ) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

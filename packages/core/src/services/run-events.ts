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

  delete(runId: string): void {
    this.controllers.delete(runId);
  }
}

export async function* replayRunEvents(
  repository: RomeoRepository,
  runId: string,
): AsyncIterable<RunEvent> {
  let yielded = 0;

  while (true) {
    const events = await repository.listRunEvents(runId);
    const pending = events.slice(yielded);

    for (const event of pending) {
      yielded += 1;
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

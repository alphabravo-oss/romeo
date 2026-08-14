import type { QueryClient } from "@tanstack/react-query";

import type { RunEvent } from "../features/runs";
import type { Message } from "../features/types";
import type { MessageKey } from "./i18n";
import { providerRunFailure } from "./run-registry-events";
import { reconcileAssistantTranscript, setAssistantRunError } from "./run-registry-messages";
import type { TrackedRun } from "./run-registry-types";

export function markAssistantRunError(
  queryClient: QueryClient,
  run: TrackedRun,
  event: Pick<RunEvent, "type" | "data">,
  t: (key: MessageKey) => string,
  runs: Map<string, TrackedRun>,
  notify: () => void,
): void {
  const failure = providerRunFailure(event, t);
  setAssistantRunError(queryClient, run, {
    code: failure.code,
    message: failure.message,
  });
  const current = runs.get(run.chatId);
  if (current !== undefined && current.runId === run.runId) {
    const next = { ...current };
    delete next.error;
    runs.set(run.chatId, next);
    notify();
  }
}

export function reconcileStreamingTranscript(
  chatId: string,
  current: Message[] | undefined,
  incoming: Message[],
  run: TrackedRun | undefined,
): Message[] {
  if (run?.isStreaming !== true) return incoming;
  return reconcileAssistantTranscript(current, incoming, run);
}

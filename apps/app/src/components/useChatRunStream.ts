import { useRef, useState, type Dispatch, type SetStateAction } from "react";

import type { Message } from "../features/types";
import {
  cancelRun,
  getRun,
  streamRunEvents,
  type RunEvent,
} from "../features/runs";
import type { MessageKey } from "../lib/i18n";

export interface ChatRunActivity {
  id: string;
  label: string;
  state: "active" | "complete" | "error";
  type: RunEvent["type"];
}

export type ChatCitation = NonNullable<Message["citations"]>[number];

interface ChatRunStreamOptions {
  setError: (error: string | undefined) => void;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  t: (key: MessageKey) => string;
}

export function useChatRunStream({
  setError,
  setMessages,
  t,
}: ChatRunStreamOptions) {
  const [activeRunId, setActiveRunId] = useState<string>();
  const [runActivities, setRunActivities] = useState<ChatRunActivity[]>([]);
  const [citations, setCitations] = useState<ChatCitation[]>([]);
  const abortRef = useRef<AbortController | undefined>(undefined);

  async function consumeRunStream(runId: string) {
    const controller = new AbortController();
    abortRef.current = controller;
    let afterSequence = 0;
    let reconnectAttempts = 0;

    try {
      const consumeEvents = async () => {
        while (!controller.signal.aborted) {
          let terminalSeen = false;
          try {
            for await (const event of streamRunEvents(
              runId,
              controller.signal,
              afterSequence,
            )) {
              if (event.sequence <= afterSequence) continue;
              afterSequence = event.sequence;
              reconnectAttempts = 0;
              if (event.type === "message.delta") {
                appendAssistantDelta(
                  setMessages,
                  (event.data as { text?: string }).text ?? "",
                );
              }
              consumeRunActivity(event, setCitations, setRunActivities, t);
              if (event.type === "run.failed") {
                setError(providerRunFailureMessage(event.data, t));
              }
              if (
                event.type === "run.completed" ||
                event.type === "run.failed" ||
                event.type === "run.cancelled"
              ) {
                terminalSeen = true;
              }
            }
            if (terminalSeen || controller.signal.aborted) return;
            throw new Error(t("runStreamClosed"));
          } catch (caught) {
            if (controller.signal.aborted) return;
            reconnectAttempts += 1;
            if (reconnectAttempts > 5) throw caught;
            await abortableDelay(
              Math.min(250 * 2 ** (reconnectAttempts - 1), 4_000),
              controller.signal,
            );
          }
        }
      };
      const observeTerminalRecord = waitForRunTerminal(
        runId,
        controller.signal,
      ).then((status) => {
        if (status === "failed") setError(t("providerFailed"));
        if (status !== undefined) controller.abort("terminal run observed");
      });
      await Promise.race([consumeEvents(), observeTerminalRecord]);
    } finally {
      controller.abort();
      abortRef.current = undefined;
      setActiveRunId(undefined);
    }
  }

  function handleCancel() {
    const runId = activeRunId;
    if (runId === undefined) return;
    abortRef.current?.abort();
    void cancelRun(runId).catch((caught) =>
      setError(caught instanceof Error ? caught.message : t("unableCancelRun")),
    );
    setActiveRunId(undefined);
  }

  function resetRunPresentation(): void {
    setRunActivities([]);
    setCitations([]);
  }

  return {
    activeRunId,
    citations,
    consumeRunStream,
    handleCancel,
    isStreaming: activeRunId !== undefined,
    resetRunPresentation,
    runActivities,
    setActiveRunId,
  };
}

function appendAssistantDelta(
  setMessages: Dispatch<SetStateAction<Message[]>>,
  delta: string,
): void {
  setMessages((current) => {
    const next = [...current];
    const last = next.at(-1);
    if (last?.role === "assistant") {
      next[next.length - 1] = { ...last, content: last.content + delta };
    }
    return next;
  });
}

function consumeRunActivity(
  event: RunEvent,
  setCitations: Dispatch<SetStateAction<ChatCitation[]>>,
  setActivities: Dispatch<SetStateAction<ChatRunActivity[]>>,
  t: (key: MessageKey) => string,
): void {
  if (event.type === "retrieval.completed") {
    const eventCitations = (event.data as { citations?: unknown }).citations;
    if (Array.isArray(eventCitations)) {
      setCitations(
        eventCitations.flatMap((item) => {
          const citation = item as Partial<ChatCitation>;
          return typeof citation.chunkId === "string" &&
            typeof citation.documentId === "string" &&
            typeof citation.title === "string"
            ? [citation as ChatCitation]
            : [];
        }),
      );
    }
  }
  const activity = activityFromEvent(event, t);
  if (activity === undefined) return;
  setActivities((current) => [
    ...current.filter((item) => item.id !== activity.id),
    activity,
  ]);
}

function abortableDelay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    function onAbort() {
      window.clearTimeout(timeout);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function waitForRunTerminal(
  runId: string,
  signal: AbortSignal,
): Promise<"cancelled" | "completed" | "failed" | undefined> {
  while (!signal.aborted) {
    try {
      const run = await getRun(runId);
      if (
        run.status === "cancelled" ||
        run.status === "completed" ||
        run.status === "failed"
      ) {
        return run.status;
      }
    } catch {
      // The event stream remains primary; transient status reads can recover.
    }
    try {
      await abortableDelay(500, signal);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function providerRunFailureMessage(
  data: unknown,
  t: (key: MessageKey) => string,
): string {
  const record =
    typeof data === "object" && data !== null
      ? (data as Record<string, unknown>)
      : {};
  const errorCode =
    typeof record.errorCode === "string" ? record.errorCode : "";
  const errorType =
    typeof record.errorType === "string" ? record.errorType : "";
  if (errorCode === "provider_credential_unavailable") {
    return t("providerCredentialUnavailable");
  }
  if (errorType.endsWith("http_401")) return t("providerRejectedKey");
  if (errorType.endsWith("http_403")) return t("providerDenied");
  if (errorType.endsWith("http_404")) return t("providerNotFound");
  if (errorType.endsWith("http_429")) return t("providerRateLimited");
  if (/http_5\d\d$/u.test(errorType)) return t("providerUnavailable");
  if (errorCode === "provider_stream_aborted") return t("responseStopped");
  return t("providerFailed");
}

function activityFromEvent(
  event: RunEvent,
  t: (key: MessageKey) => string,
): ChatRunActivity | undefined {
  const definitions: Partial<
    Record<RunEvent["type"], { label: string; state: ChatRunActivity["state"] }>
  > = {
    "run.started": {
      label: t("chatActivityGeneratingResponse"),
      state: "active",
    },
    "retrieval.completed": {
      label: t("chatActivitySourcesRetrieved"),
      state: "complete",
    },
    "tool.started": {
      label: t("chatActivityRunningTool"),
      state: "active",
    },
    "tool.approval_required": {
      label: t("chatActivityToolApprovalRequired"),
      state: "active",
    },
    "tool.completed": {
      label: t("chatActivityToolCompleted"),
      state: "complete",
    },
    "tool.failed": {
      label: t("chatActivityToolFailed"),
      state: "error",
    },
    "run.continuing": {
      label: t("chatActivityContinuingAfterTool"),
      state: "active",
    },
    "run.completed": {
      label: t("chatActivityResponseComplete"),
      state: "complete",
    },
    "run.cancelled": {
      label: t("chatActivityResponseStopped"),
      state: "error",
    },
    "run.failed": {
      label: t("chatActivityResponseFailed"),
      state: "error",
    },
  };
  const definition = definitions[event.type];
  return definition === undefined
    ? undefined
    : {
        id: `${event.runId}:${event.type}`,
        label: definition.label,
        state: definition.state,
        type: event.type,
      };
}

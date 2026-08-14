import type { QueryClient } from "@tanstack/react-query";

import type { RunEvent } from "../features/runs";
import type { Message } from "../features/types";
import type { MessageKey } from "./i18n";
import type { ChatToolCall } from "./run-tool-calls";

export interface ChatRunActivity {
  id: string;
  label: string;
  state: "active" | "complete" | "error";
  type: RunEvent["type"];
}

export type ChatCitation = NonNullable<Message["citations"]>[number];

export interface ChatReasoning {
  completed?: boolean;
  seconds: number;
  text: string;
}

export type RunStreamState =
  | "connecting"
  | "live"
  | "reconnecting"
  | "caught_up"
  | "suspended"
  | "completed"
  | "cancelled"
  | "failed";

export interface ChatRunWait {
  attempt: number;
  elapsedSeconds: number;
  hasContent: boolean;
  maxAttempts: number;
  phase: "waiting" | "streaming" | "retrying" | "reconnecting";
  reconnectAttempts?: number;
  maxReconnectAttempts?: number;
  streamTimeoutMs?: number;
}

export interface ActiveRun {
  activities: ChatRunActivity[];
  assistantMessageId: string;
  chatId: string;
  citations: ChatCitation[];
  error?: string;
  isStreaming: boolean;
  reasoning?: ChatReasoning;
  runId: string;
  streamState: RunStreamState;
  toolCalls: ChatToolCall[];
  wait?: ChatRunWait;
}

export interface TrackedRun extends ActiveRun {
  /** Shared across immutable registry snapshots; deltas do not publish them. */
  assistantBuffer: {
    committed?: Message;
    flushTimer?: ReturnType<typeof setTimeout>;
    message: Message;
    pendingDelta: string;
  };
  controller: AbortController;
  modelId?: string;
  /** Browser connectivity is not trusted again until authz revalidation. */
  networkSuspended: boolean;
  /** An SSE frame arrived while presentation was held behind that boundary. */
  networkActivityWhileSuspended: boolean;
  parentMessageId?: string;
  queryClient: QueryClient;
  reasoningStartedAt?: string;
  t: (key: MessageKey) => string;
  /**
   * Wait-clock state, shared by reference across registry snapshots for the
   * same reason as assistantBuffer. publish() replaces the entry with
   * {...current, ...patch}, so a primitive written through one reference is
   * invisible through the other -- which previously left the ticker measuring
   * from trackRun time instead of from run.started, and let the interval
   * handle diverge between the closure and the map entry.
   */
  timing: {
    waitAttemptStartedAt: number;
    waitTicker?: ReturnType<typeof setInterval>;
  };
}

export interface TrackRunInput {
  chatId: string;
  runId: string;
  parentMessageId?: string;
  queryClient: QueryClient;
  t: (key: MessageKey) => string;
  onSettled?: (chatId: string, runId: string) => void | Promise<void>;
}

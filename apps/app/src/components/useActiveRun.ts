import { useSyncExternalStore } from "react";

import {
  cancelActiveRun,
  getActiveRun,
  subscribeToRuns,
  type ChatCitation,
  type ChatReasoning,
  type ChatRunActivity,
} from "../lib/run-registry";
import type { ChatToolCall } from "../lib/run-tool-calls";

// Frozen singletons: the hook returns them whenever the chat has no run, so a
// chat sitting idle never hands its consumers a fresh array identity.
const noActivities: ChatRunActivity[] = [];
const noCitations: ChatCitation[] = [];
const noToolCalls: ChatToolCall[] = [];

/**
 * Read-only view of the module-level run registry for one chat. The registry
 * keeps streaming whether or not anything is subscribed, so unmounting this
 * hook (navigating away) never interrupts the answer.
 */
export function useActiveRun(chatId: string | undefined): {
  activities: ChatRunActivity[];
  citations: ChatCitation[];
  error: string | undefined;
  isStreaming: boolean;
  handleCancel: () => void;
  reasoning: ChatReasoning | undefined;
  toolCalls: ChatToolCall[];
} {
  const run = useSyncExternalStore(
    subscribeToRuns,
    () => getActiveRun(chatId),
    () => undefined,
  );
  return {
    activities: run?.activities ?? noActivities,
    citations: run?.citations ?? noCitations,
    error: run?.error,
    isStreaming: run?.isStreaming === true,
    handleCancel: () => {
      if (chatId !== undefined) cancelActiveRun(chatId);
    },
    reasoning: run?.reasoning,
    toolCalls: run?.toolCalls ?? noToolCalls,
  };
}

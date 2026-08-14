import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { messageFeedbackQueryOptions } from "../features";
import type { RunContextPreview } from "../features/chat";
import { queuedTurnsQueryOptions, type QueuedChatTurn } from "../features/runs";
import type { MessageFeedbackState } from "../features/types";
import { useActiveRun } from "./useActiveRun";

const noQueuedTurns: QueuedChatTurn[] = [];
const noFeedback: Record<string, MessageFeedbackState> = {};

export function useWorkspaceRuntimeState(activeChatId: string | undefined) {
  const queuedTurnsQuery = useQuery(queuedTurnsQueryOptions(activeChatId));
  const messageFeedbackQuery = useQuery(
    messageFeedbackQueryOptions(activeChatId),
  );
  const [contextPreview, setContextPreview] = useState<RunContextPreview>();
  const [contextPreviewError, setContextPreviewError] = useState<string>();
  const [isInspectingContext, setIsInspectingContext] = useState(false);
  const [error, setError] = useState<string>();
  const activeRun = useActiveRun(activeChatId);

  return {
    ...activeRun,
    contextPreview,
    contextPreviewError,
    error,
    isInspectingContext,
    messageFeedback: messageFeedbackQuery.data ?? noFeedback,
    queuedTurns: queuedTurnsQuery.data ?? noQueuedTurns,
    setContextPreview,
    setContextPreviewError,
    setError,
    setIsInspectingContext,
  };
}

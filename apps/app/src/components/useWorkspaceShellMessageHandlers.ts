import { useCallback } from "react";

import type { QueuedChatTurn } from "../features/runs";
import { useCommittedLatest } from "./useCommittedLatest";
import type { useWorkspaceController } from "./useWorkspaceController";

type WorkspaceController = ReturnType<typeof useWorkspaceController>;

/** Stable message callbacks keep memoized transcript rows quiet while streaming. */
export function useWorkspaceShellMessageHandlers(
  workspace: WorkspaceController,
) {
  const latest = useCommittedLatest(workspace);
  return {
    handleAttachmentRetention: useCallback(
      (messageId: string, attachmentId: string, retained: boolean) =>
        void latest.current.handleAttachmentRetention(
          messageId,
          attachmentId,
          retained,
        ),
      [latest],
    ),
    handleBranch: useCallback(
      (messageId: string) =>
        void latest.current.handleBranchFromMessage(messageId),
      [latest],
    ),
    handleCancelQueuedTurn: useCallback(
      (turn: QueuedChatTurn) =>
        void latest.current.handleCancelQueuedTurn(turn),
      [latest],
    ),
    handleContinue: useCallback(
      () => void latest.current.handleContinueResponse(),
      [latest],
    ),
    handleDeleteMessage: useCallback(
      (messageId: string) => void latest.current.handleDeleteMessage(messageId),
      [latest],
    ),
    handleEditAndResend: useCallback(
      (messageId: string, content: string) =>
        latest.current.handleEditAndResend(messageId, content),
      [latest],
    ),
    handleGenerateSpeech: useCallback(
      (messageId: string) =>
        void latest.current.handleGenerateSpeech(messageId),
      [latest],
    ),
    handleRateMessage: useCallback(
      (
        messageId: string,
        rating: "negative" | "none" | "positive",
        reasonCode?: string,
      ) => void latest.current.handleRateMessage(messageId, rating, reasonCode),
      [latest],
    ),
    handleRegenerate: useCallback(
      () => void latest.current.regenerateLast(),
      [latest],
    ),
    handleSelectVariant: useCallback(
      (messageId: string) => void latest.current.handleSelectVariant(messageId),
      [latest],
    ),
  };
}

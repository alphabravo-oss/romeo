import { useEffect, useEffectEvent, useRef } from "react";

import { getActiveChatRun, type QueuedChatTurn } from "../features/runs";

export function useQueuedTurnRecovery(options: {
  chatId: string | undefined;
  errorMessage: string;
  queuedTurns: readonly QueuedChatTurn[];
  queuedTurnsUpdatedAt: number;
  setError: (error: string | undefined) => void;
  syncPersistedMessages: (chatId: string) => Promise<void>;
  trackChatRun: (chatId: string, runId: string) => void;
}): void {
  const lastRecovery = useRef<string | undefined>(undefined);
  const recover = useEffectEvent(
    async (
      chatId: string,
      queuedTurns: readonly QueuedChatTurn[],
      isCancelled: () => boolean,
    ) => {
      try {
        const activeRun = await getActiveChatRun(chatId);
        if (isCancelled()) return;
        if (activeRun !== null) {
          options.trackChatRun(chatId, activeRun.id);
          return;
        }
        if (queuedTurns.length === 0) {
          await options.syncPersistedMessages(chatId);
        }
      } catch {
        if (!isCancelled()) options.setError(options.errorMessage);
      }
    },
  );
  useEffect(() => {
    const chatId = options.chatId;
    if (chatId === undefined || options.queuedTurnsUpdatedAt === 0) return;
    const signature = `${chatId}:${options.queuedTurnsUpdatedAt}:${options.queuedTurns
      .map((turn) => `${turn.id}:${turn.status}`)
      .join(",")}`;
    if (lastRecovery.current === signature) return;
    lastRecovery.current = signature;
    let cancelled = false;
    void recover(chatId, options.queuedTurns, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [options.chatId, options.queuedTurns, options.queuedTurnsUpdatedAt]);
}

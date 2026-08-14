import { useEffect, useEffectEvent, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { ChatChangedEvent } from "../features";
import {
  isActiveChatRemoval,
  shouldApplyRequestedChat,
  shouldAutoSelectChat,
  shouldClearActiveChat,
} from "./chat-selection";
import { safeUserErrorMessage } from "../lib/safe-user-error";

interface WorkspaceSelectionSyncOptions {
  activeAgentId: string | undefined;
  activeChatId: string | undefined;
  /** chats[0]?.id -- what auto-selection falls back to. */
  firstChatId: string | undefined;
  handleChatDeleted: (chatId: string) => Promise<void>;
  isDraftingNewChat: boolean;
  isStreaming: boolean;
  latestChatEvent: ChatChangedEvent | undefined;
  onAgentSelection?: (agentId: string) => void;
  onChatSelection?: (
    chatId: string | undefined,
    options?: { replace: boolean },
  ) => void;
  requestedAgentId: string | undefined;
  requestedChatId: string | undefined;
  /** The agent the open chat actually belongs to, once its data has loaded. */
  resolvedActiveAgentId: string | undefined;
  selectChat: (chatId: string) => Promise<void>;
  setActiveAgentId: Dispatch<SetStateAction<string | undefined>>;
  setActiveChatId: Dispatch<SetStateAction<string | undefined>>;
  setError: Dispatch<SetStateAction<string | undefined>>;
  setIsDraftingNewChat: Dispatch<SetStateAction<boolean>>;
  setModelOverrideId: Dispatch<SetStateAction<string | undefined>>;
}

/**
 * Keeps the open chat, the open agent and the URL agreeing with one another.
 *
 * Everything here is a reconciliation of state the user did not set directly:
 * a `?chat` the address bar arrived with, a chat another device archived, the
 * agent that turns out to own the chat that just loaded. Direct actions
 * (clicking a chat, pressing "New chat") stay in the controller, because they
 * already know exactly what they want.
 */
export function useWorkspaceSelectionSync(
  options: WorkspaceSelectionSyncOptions,
): void {
  const {
    activeAgentId,
    activeChatId,
    firstChatId,
    isDraftingNewChat,
    isStreaming,
    latestChatEvent,
    requestedAgentId,
    requestedChatId,
    resolvedActiveAgentId,
    setActiveAgentId,
    setError,
  } = options;
  const handledChatRemovalEventId = useRef<string | undefined>(undefined);

  const selectChatFromEffect = useEffectEvent(
    async (chatId: string, notifySelection: boolean) => {
      options.setModelOverrideId(undefined);
      await options.selectChat(chatId);
      // Replaces rather than pushes: nobody asked for this chat, it is the
      // app repairing a selection, so it belongs to the entry already on
      // screen instead of earning one of its own in the back stack.
      if (notifySelection) options.onChatSelection?.(chatId, { replace: true });
    },
  );
  const notifyAgentSelection = useEffectEvent((agentId: string) => {
    options.onAgentSelection?.(agentId);
  });
  const reconcileRemoteChatRemoval = useEffectEvent(async (chatId: string) => {
    await options.handleChatDeleted(chatId);
    options.onChatSelection?.(undefined, { replace: true });
  });
  const reconcileRequestedChat = useEffectEvent(
    (chatId: string | undefined) => {
      if (chatId !== undefined) {
        // Walking FORWARD onto a chat entry after Back parked us on a blank
        // one. The blank composer was the previous entry's intent, not this
        // one's, and leaving the flag set would make shouldApplyRequestedChat
        // ignore the chat the URL is now asking for.
        options.setIsDraftingNewChat(false);
        return;
      }
      if (
        !shouldClearActiveChat({
          activeChatId,
          isDraftingNewChat,
          isStreaming,
          requestedChatId: chatId,
        })
      )
        return;
      options.setActiveChatId(undefined);
      // Without this the auto-select fallback below immediately re-opens
      // chats[0] and Back reads as a no-op. See ./chat-selection.
      options.setIsDraftingNewChat(true);
    },
  );

  useEffect(() => {
    if (requestedAgentId !== undefined) setActiveAgentId(requestedAgentId);
  }, [requestedAgentId, setActiveAgentId]);

  // Depends on `?chat` alone, on purpose. Only a CHANGE to the search param is
  // a navigation; the URL trails our own selections by a tick, so re-running
  // this on activeChatId would see "the URL has no chat" in the moment right
  // after auto-select opened one and close it again.
  useEffect(() => {
    reconcileRequestedChat(requestedChatId);
  }, [requestedChatId]);

  useEffect(() => {
    const requestedChat = {
      activeChatId,
      isDraftingNewChat,
      requestedChatId,
    };
    if (!shouldApplyRequestedChat(requestedChat)) return;
    void selectChatFromEffect(requestedChat.requestedChatId, false).catch(
      (caught) =>
        setError(safeUserErrorMessage(caught, "Unable to load chat.")),
    );
  }, [activeChatId, isDraftingNewChat, requestedChatId, setError]);

  useEffect(() => {
    if (
      !isActiveChatRemoval(activeChatId, latestChatEvent) ||
      handledChatRemovalEventId.current === latestChatEvent.id
    )
      return;
    handledChatRemovalEventId.current = latestChatEvent.id;
    void reconcileRemoteChatRemoval(latestChatEvent.chatId);
  }, [activeChatId, latestChatEvent]);

  useEffect(() => {
    if (
      activeChatId === undefined ||
      resolvedActiveAgentId === undefined ||
      activeAgentId === resolvedActiveAgentId
    )
      return;
    setActiveAgentId(resolvedActiveAgentId);
    notifyAgentSelection(resolvedActiveAgentId);
  }, [activeAgentId, activeChatId, resolvedActiveAgentId, setActiveAgentId]);

  // Fall back to the most recent chat whenever the active one goes away, so an
  // archive/delete lands the user somewhere real instead of on a dead view.
  // It must NOT fire when the user asked for a blank chat -- see
  // ./chat-selection for why activeChatId alone cannot tell those apart.
  useEffect(() => {
    if (firstChatId === undefined) return;
    if (
      !shouldAutoSelectChat({
        activeChatId,
        firstChatId,
        isDraftingNewChat,
        isStreaming,
      })
    )
      return;
    void selectChatFromEffect(firstChatId, true).catch((caught) =>
      setError(safeUserErrorMessage(caught, "Unable to load chat.")),
    );
  }, [activeChatId, firstChatId, isDraftingNewChat, isStreaming, setError]);
}

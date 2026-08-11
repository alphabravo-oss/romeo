import type { QueryClient } from "@tanstack/react-query";
import type { Dispatch, SetStateAction } from "react";

import { archiveChat, updateChat, type SpeechArtifact } from "../features";
import { cancelQueuedTurn, getActiveChatRun } from "../features/runs";
import type { QueuedChatTurn } from "../features/runs";
import type { Chat, Message } from "../features/types";
import type { MessageKey } from "../lib/i18n";
import { deepestLeaf } from "./message-tree";

interface WorkspaceChatActionsOptions {
  activeChatId: string | undefined;
  allMessages: Message[];
  followQueuedRuns: (chatId: string, previousRunId?: string) => Promise<void>;
  queryClient: QueryClient;
  setActiveAgentId: Dispatch<SetStateAction<string | undefined>>;
  setActiveChatId: Dispatch<SetStateAction<string | undefined>>;
  setAttachedUrls: Dispatch<SetStateAction<string[]>>;
  setError: Dispatch<SetStateAction<string | undefined>>;
  setIsDraftingNewChat: Dispatch<SetStateAction<boolean>>;
  setModelOverrideId: Dispatch<SetStateAction<string | undefined>>;
  setSpeechArtifacts: Dispatch<SetStateAction<Record<string, SpeechArtifact>>>;
  setTemporaryNextChat: Dispatch<SetStateAction<boolean>>;
  syncPersistedMessages: (chatId: string) => Promise<void>;
  t: (key: MessageKey) => string;
  trackChatRun: (chatId: string, runId: string) => void;
  workspaceId: string | undefined;
}

export function useWorkspaceChatActions(options: WorkspaceChatActionsOptions) {
  // Addressed by the turn's own chat, not by the chat on screen: the two agree
  // today only because each chat renders its own queue, and a cancel sent to
  // the wrong chat is a 404 rather than a visible failure.
  async function handleCancelQueuedTurn(turn: QueuedChatTurn) {
    try {
      await cancelQueuedTurn(turn.chatId, turn.id);
      await options.queryClient.invalidateQueries({
        queryKey: ["queuedTurns", turn.chatId],
      });
    } catch (caught) {
      options.setError(
        caught instanceof Error
          ? caught.message
          : options.t("unableRemoveQueued"),
      );
    }
  }

  // No streaming lock on either entry point: the registry owns the stream, so
  // a run started in this chat keeps writing to its own cache key while the
  // user reads or starts another conversation.
  async function handleSelectChat(chatId: string) {
    options.setActiveChatId(chatId);
    options.setIsDraftingNewChat(false);
    options.setError(undefined);
    // The queue is a per-chat query keyed off the chat now on screen, so it
    // reloads itself rather than being pushed in from here.
    const [activeRun] = await Promise.all([
      getActiveChatRun(chatId),
      options.syncPersistedMessages(chatId),
    ]);
    // Selecting a chat mid-answer rejoins the run instead of refusing to move.
    if (activeRun !== null) options.trackChatRun(chatId, activeRun.id);
    await options.followQueuedRuns(chatId, activeRun?.id);
  }

  function handleNewChat() {
    options.setActiveChatId(undefined);
    options.setIsDraftingNewChat(true);
    options.setSpeechArtifacts({});
    options.setError(undefined);
    options.setTemporaryNextChat(false);
  }

  // Switching variants moves the chat's leaf pointer to the bottom of the
  // chosen sibling's branch; the displayed path is derived from that pointer,
  // so writing the fresh chat straight into its cache re-renders immediately
  // instead of waiting for a refetch.
  async function handleSelectVariant(messageId: string) {
    const chatId = options.activeChatId;
    if (chatId === undefined) return;
    options.setError(undefined);
    try {
      const updated = await updateChat(chatId, {
        activeLeafMessageId: deepestLeaf(options.allMessages, messageId),
      });
      options.queryClient.setQueryData<Chat>(["chat", chatId], updated);
    } catch (caught) {
      options.setError(
        caught instanceof Error
          ? caught.message
          : options.t("unableSwitchVariant"),
      );
    }
  }

  function handleNewTemporaryChat() {
    handleNewChat();
    options.setTemporaryNextChat(true);
  }

  function handleAddUrl(url: string) {
    try {
      const normalized = new URL(url).toString();
      options.setAttachedUrls((current) =>
        current.includes(normalized)
          ? current
          : [...current, normalized].slice(0, 5),
      );
      options.setError(undefined);
    } catch {
      options.setError(options.t("invalidUrl"));
    }
  }

  async function handleSelectModel(modelId: string) {
    options.setModelOverrideId(modelId);
    if (options.activeChatId === undefined || options.workspaceId === undefined)
      return;
    try {
      await updateChat(options.activeChatId, { modelId });
      await invalidateWorkspaceChats(options);
    } catch (caught) {
      options.setError(
        caught instanceof Error
          ? caught.message
          : "Unable to save the chat model.",
      );
    }
  }

  async function handleChatDeleted(chatId: string) {
    resetRemovedActiveChat(options, chatId);
    await Promise.all([
      invalidateWorkspaceChats(options),
      options.queryClient.invalidateQueries({
        queryKey: ["chatComments", chatId],
      }),
      options.queryClient.invalidateQueries({ queryKey: ["notifications"] }),
      options.queryClient.invalidateQueries({
        queryKey: ["notificationDeliveries"],
      }),
      options.queryClient.invalidateQueries({ queryKey: ["auditLogs"] }),
      options.queryClient.invalidateQueries({ queryKey: ["usageEvents"] }),
      options.queryClient.invalidateQueries({ queryKey: ["usageSummary"] }),
    ]);
  }

  async function handleChatArchived(chatId: string) {
    resetRemovedActiveChat(options, chatId);
    await Promise.all([
      invalidateWorkspaceChats(options),
      options.queryClient.invalidateQueries({
        queryKey: ["chatComments", chatId],
      }),
      options.queryClient.invalidateQueries({ queryKey: ["auditLogs"] }),
      options.queryClient.invalidateQueries({ queryKey: ["accessReview"] }),
    ]);
  }

  async function renameChat(chatId: string, title: string): Promise<void> {
    const trimmed = title.trim();
    if (trimmed.length === 0) return;
    options.setError(undefined);
    try {
      await updateChat(chatId, { title: trimmed });
      await invalidateWorkspaceChats(options);
    } catch (caught) {
      options.setError(
        caught instanceof Error ? caught.message : "Unable to rename chat.",
      );
    }
  }

  async function deleteChat(chatId: string): Promise<void> {
    options.setError(undefined);
    try {
      await archiveChat(chatId);
      await handleChatArchived(chatId);
    } catch (caught) {
      options.setError(
        caught instanceof Error ? caught.message : "Unable to delete chat.",
      );
    }
  }

  async function handleWorkspaceArchived(workspaceId: string) {
    options.setActiveChatId(undefined);
    options.setIsDraftingNewChat(false);
    options.setActiveAgentId(undefined);
    options.setSpeechArtifacts({});
    await Promise.all([
      options.queryClient.invalidateQueries({ queryKey: ["bootstrap"] }),
      options.queryClient.invalidateQueries({
        queryKey: ["agents", workspaceId],
      }),
      options.queryClient.invalidateQueries({
        queryKey: ["chats", workspaceId],
      }),
      options.queryClient.invalidateQueries({
        queryKey: ["knowledgeBases", workspaceId],
      }),
      options.queryClient.invalidateQueries({
        queryKey: ["agentGallery", workspaceId],
      }),
      options.queryClient.invalidateQueries({ queryKey: ["auditLogs"] }),
      options.queryClient.invalidateQueries({ queryKey: ["accessReview"] }),
    ]);
  }

  return {
    deleteChat,
    handleAddUrl,
    handleCancelQueuedTurn,
    handleChatArchived,
    handleChatDeleted,
    handleNewChat,
    handleNewTemporaryChat,
    handleSelectChat,
    handleSelectModel,
    handleSelectVariant,
    handleWorkspaceArchived,
    renameChat,
  };
}

function resetRemovedActiveChat(
  options: WorkspaceChatActionsOptions,
  chatId: string,
): void {
  if (options.activeChatId !== chatId) return;
  options.setActiveChatId(undefined);
  options.setIsDraftingNewChat(false);
  options.setSpeechArtifacts({});
}

function invalidateWorkspaceChats(
  options: WorkspaceChatActionsOptions,
): Promise<unknown> {
  return options.workspaceId === undefined
    ? Promise.resolve()
    : options.queryClient.invalidateQueries({
        queryKey: ["chats", options.workspaceId],
      });
}

import type { QueryClient } from "@tanstack/react-query";
import type { Dispatch, SetStateAction } from "react";

import {
  archiveChat,
  updateChat,
  type Message,
  type SpeechArtifact,
} from "../features";
import {
  cancelQueuedTurn,
  getActiveChatRun,
  listQueuedTurns,
} from "../features/runs";
import type { QueuedChatTurn } from "../features/runs";
import type { MessageKey } from "../lib/i18n";

interface WorkspaceChatActionsOptions {
  activeChatId: string | undefined;
  appendMessage: (
    chatId: string,
    role: Message["role"],
    content: string,
    attachments?: Message["attachments"],
  ) => void;
  consumeRunStream: (runId: string) => Promise<void>;
  followQueuedRuns: (chatId: string, previousRunId?: string) => Promise<void>;
  isStreaming: boolean;
  queryClient: QueryClient;
  setActiveAgentId: Dispatch<SetStateAction<string | undefined>>;
  setActiveChatId: Dispatch<SetStateAction<string | undefined>>;
  setActiveRunId: Dispatch<SetStateAction<string | undefined>>;
  setAttachedUrls: Dispatch<SetStateAction<string[]>>;
  setError: Dispatch<SetStateAction<string | undefined>>;
  setIsDraftingNewChat: Dispatch<SetStateAction<boolean>>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setModelOverrideId: Dispatch<SetStateAction<string | undefined>>;
  setQueuedTurns: Dispatch<SetStateAction<QueuedChatTurn[]>>;
  setSpeechArtifacts: Dispatch<SetStateAction<Record<string, SpeechArtifact>>>;
  setTemporaryNextChat: Dispatch<SetStateAction<boolean>>;
  syncPersistedMessages: (chatId: string) => Promise<void>;
  t: (key: MessageKey) => string;
  workspaceId: string | undefined;
}

export function useWorkspaceChatActions(options: WorkspaceChatActionsOptions) {
  async function handleCancelQueuedTurn(turnId: string) {
    if (options.activeChatId === undefined) return;
    try {
      await cancelQueuedTurn(options.activeChatId, turnId);
      options.setQueuedTurns(await listQueuedTurns(options.activeChatId));
    } catch (caught) {
      options.setError(
        caught instanceof Error
          ? caught.message
          : options.t("unableRemoveQueued"),
      );
    }
  }

  async function handleSelectChat(chatId: string) {
    if (options.isStreaming) return;
    options.setActiveChatId(chatId);
    options.setIsDraftingNewChat(false);
    options.setError(undefined);
    const [activeRun, serverQueue] = await Promise.all([
      getActiveChatRun(chatId),
      listQueuedTurns(chatId),
      options.syncPersistedMessages(chatId),
    ]).then(([run, queue]) => [run, queue] as const);
    options.setQueuedTurns(serverQueue);
    if (activeRun !== null) {
      options.setActiveRunId(activeRun.id);
      options.appendMessage(chatId, "assistant", "");
      await options.consumeRunStream(activeRun.id);
      await options.syncPersistedMessages(chatId);
    }
    await options.followQueuedRuns(chatId, activeRun?.id);
  }

  function handleNewChat() {
    if (options.isStreaming) return;
    options.setActiveChatId(undefined);
    options.setIsDraftingNewChat(true);
    options.setMessages([]);
    options.setSpeechArtifacts({});
    options.setError(undefined);
    options.setTemporaryNextChat(false);
    options.setQueuedTurns([]);
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
    options.setMessages([]);
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
  options.setMessages([]);
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

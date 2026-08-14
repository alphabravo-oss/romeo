import { useMutation, type QueryClient } from "@tanstack/react-query";
import type { Dispatch, SetStateAction } from "react";

import type { SpeechArtifact } from "../features";
import {
  archiveWorkspaceChatMutationOptions,
  updateWorkspaceChatMutationOptions,
} from "../features/chats/mutation-options";
import { workspaceModelPreferenceMutationOptions } from "../features/interface-preferences/mutation-options";
import { getActiveChatRun } from "../features/runs";
import type { QueuedChatTurn } from "../features/runs";
import { cancelQueuedTurnMutationOptions } from "../features/runs/mutation-options";
import type { MessageKey } from "../lib/i18n";
import { safeUserErrorMessage } from "../lib/safe-user-error";
import { apiQueryKeys } from "../lib/api-query-options";
import * as appQueryKeys from "../lib/app-query-keys";
import { invalidateCachedResourceExactly } from "../lib/server-mutation-options";

interface WorkspaceChatActionsOptions {
  activeChatId: string | undefined;
  onBranchSelection?: (leafMessageId: string) => void;
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
  const archiveChatMutation = useMutation(
    archiveWorkspaceChatMutationOptions(),
  );
  const cancelQueuedTurnMutation = useMutation(
    cancelQueuedTurnMutationOptions(),
  );
  const updateChatMutation = useMutation(updateWorkspaceChatMutationOptions());
  const workspaceModelPreferenceMutation = useMutation(
    workspaceModelPreferenceMutationOptions(),
  );
  // Addressed by the turn's own chat, not by the chat on screen: the two agree
  // today only because each chat renders its own queue, and a cancel sent to
  // the wrong chat is a 404 rather than a visible failure.
  async function handleCancelQueuedTurn(turn: QueuedChatTurn) {
    try {
      await cancelQueuedTurnMutation.mutateAsync({
        chatId: turn.chatId,
        turnId: turn.id,
      });
    } catch (caught) {
      options.setError(
        safeUserErrorMessage(caught, options.t("unableRemoveQueued")),
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

  // Branch selection is reader-scoped. The server already returned an
  // authorized descendant-leaf target, so navigating does not mutate the
  // shared chat default or move another collaborator's view.
  function handleSelectVariant(messageId: string) {
    const chatId = options.activeChatId;
    if (chatId === undefined) return;
    options.setError(undefined);
    options.onBranchSelection?.(messageId);
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

  async function handleSelectModel(modelId: string, persistAgentId?: string) {
    options.setModelOverrideId(modelId);
    const workspaceId = options.workspaceId;
    try {
      if (workspaceId !== undefined) {
        await workspaceModelPreferenceMutation.mutateAsync({
          kind: "last",
          modelId,
          workspaceId,
        });
      }
      if (options.activeChatId !== undefined) {
        await updateChatMutation.mutateAsync({
          chatId: options.activeChatId,
          patch: {
            modelId,
            ...(persistAgentId === undefined
              ? {}
              : { agentId: persistAgentId }),
          },
          workspaceId,
        });
      }
    } catch (caught) {
      options.setError(
        safeUserErrorMessage(caught, "Unable to save the chat model."),
      );
    }
  }

  async function handleToggleDefaultModel(modelId: string) {
    const workspaceId = options.workspaceId;
    if (workspaceId === undefined) return;
    try {
      await workspaceModelPreferenceMutation.mutateAsync({
        kind: "default",
        modelId,
        workspaceId,
      });
    } catch (caught) {
      options.setError(
        safeUserErrorMessage(caught, "Unable to update the default model."),
      );
    }
  }

  async function handleChatDeleted(chatId: string) {
    resetRemovedActiveChat(options, chatId);
    await Promise.all([
      invalidateWorkspaceChats(options),
      options.queryClient.invalidateQueries({
        exact: true,
        queryKey: appQueryKeys.chatComments(chatId),
      }),
      options.queryClient.invalidateQueries({
        exact: true,
        queryKey: appQueryKeys.notifications(),
      }),
      options.queryClient.invalidateQueries({
        exact: true,
        queryKey: appQueryKeys.notificationDeliveries(),
      }),
      invalidateCachedResourceExactly(
        options.queryClient,
        appQueryKeys.auditLogs(),
      ),
      invalidateCachedResourceExactly(
        options.queryClient,
        appQueryKeys.usageEvents(),
      ),
      options.queryClient.invalidateQueries({
        exact: true,
        queryKey: appQueryKeys.usageSummary(),
      }),
    ]);
  }

  async function handleChatArchived(chatId: string) {
    resetRemovedActiveChat(options, chatId);
    await Promise.all([
      invalidateWorkspaceChats(options),
      options.queryClient.invalidateQueries({
        exact: true,
        queryKey: appQueryKeys.chatComments(chatId),
      }),
      invalidateCachedResourceExactly(
        options.queryClient,
        appQueryKeys.auditLogs(),
      ),
      options.queryClient.invalidateQueries({
        exact: true,
        queryKey: appQueryKeys.accessReview(),
      }),
    ]);
  }

  async function renameChat(chatId: string, title: string): Promise<void> {
    const trimmed = title.trim();
    if (trimmed.length === 0) return;
    options.setError(undefined);
    try {
      await updateChatMutation.mutateAsync({
        chatId,
        patch: { title: trimmed },
        workspaceId: options.workspaceId,
      });
    } catch (caught) {
      options.setError(safeUserErrorMessage(caught, "Unable to rename chat."));
    }
  }

  async function deleteChat(chatId: string): Promise<void> {
    options.setError(undefined);
    try {
      await archiveChatMutation.mutateAsync({
        chatId,
        workspaceId: options.workspaceId,
      });
      resetRemovedActiveChat(options, chatId);
    } catch (caught) {
      options.setError(safeUserErrorMessage(caught, "Unable to delete chat."));
    }
  }

  async function handleWorkspaceArchived(workspaceId: string) {
    options.setActiveChatId(undefined);
    options.setIsDraftingNewChat(false);
    options.setActiveAgentId(undefined);
    options.setSpeechArtifacts({});
    await Promise.all([
      options.queryClient.invalidateQueries({
        exact: true,
        queryKey: apiQueryKeys.bootstrap(),
      }),
      options.queryClient.invalidateQueries({
        exact: true,
        queryKey: apiQueryKeys.agents(workspaceId),
      }),
      invalidateWorkspaceChats(options),
      options.queryClient.invalidateQueries({
        exact: true,
        queryKey: appQueryKeys.knowledgeBases(workspaceId),
      }),
      options.queryClient.invalidateQueries({
        exact: true,
        queryKey: apiQueryKeys.agentGallery(workspaceId),
      }),
      invalidateCachedResourceExactly(
        options.queryClient,
        appQueryKeys.auditLogs(),
      ),
      options.queryClient.invalidateQueries({
        exact: true,
        queryKey: appQueryKeys.accessReview(),
      }),
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
    handleToggleDefaultModel,
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
): Promise<void> {
  return options.workspaceId === undefined
    ? Promise.resolve()
    : invalidateCachedResourceExactly(
        options.queryClient,
        appQueryKeys.chats(options.workspaceId),
      );
}

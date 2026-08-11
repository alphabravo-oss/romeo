import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { listMessageFeedback } from "../features";
import type { MessageFeedbackState, SpeechArtifact } from "../features/types";
import { inspectRunContext, type RunContextPreview } from "../features/chat";
import { getManagedModelPreferences } from "../features/managed-models";
import { listQueuedTurns, type QueuedChatTurn } from "../features/runs";
import { useLocale } from "../lib/i18n";
import {
  isActiveChatRemoval,
  shouldApplyRequestedChat,
  shouldAutoSelectChat,
} from "./chat-selection";
import { resolveChatModelSelection } from "./chat-model-selection";
import { useActiveRun } from "./useActiveRun";
import { useChatMessageState } from "./useChatMessageState";
import { useToolExecution } from "./useToolExecution";
import { useWorkspaceAttachments } from "./useWorkspaceAttachments";
import { useWorkspaceChatActions } from "./useWorkspaceChatActions";
import { useWorkspaceData } from "./useWorkspaceData";
import { useWorkspaceProviderActions } from "./useWorkspaceProviderActions";
import { useWorkspaceTurnActions } from "./useWorkspaceTurnActions";
import { useWorkspaceVoiceActions } from "./useWorkspaceVoiceActions";

const initialDraft = "";
// Stable identities for "this chat has nothing yet", so an idle chat does not
// hand the panel a fresh empty value on every render. Mirrors useWorkspaceData.
const noQueuedTurns: QueuedChatTurn[] = [];
const noFeedback: Record<string, MessageFeedbackState> = {};
export type {
  PendingDocumentAttachment,
  PendingImageAttachment,
} from "./useWorkspaceAttachments";

export type { ChatCitation, ChatRunActivity } from "../lib/run-registry";

export function useWorkspaceController(
  options: {
    onAgentSelection?: (agentId: string) => void;
    onChatSelection?: (chatId: string | undefined) => void;
    requestedAgentId?: string;
    requestedChatId?: string;
  } = {},
) {
  const queryClient = useQueryClient();
  const { t } = useLocale();
  const [draft, setDraft] = useState(initialDraft);
  const [activeAgentId, setActiveAgentId] = useState<string | undefined>(
    options.requestedAgentId,
  );
  const [activeChatId, setActiveChatId] = useState<string | undefined>();
  // Explicit intent: the user asked for a blank chat and there is no chat row
  // behind it yet. Distinguishes "New chat" from "the active chat vanished",
  // which look identical from activeChatId alone. See ./chat-selection.
  const [isDraftingNewChat, setIsDraftingNewChat] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [attachedUrls, setAttachedUrls] = useState<string[]>([]);
  const [temporaryNextChat, setTemporaryNextChat] = useState(false);
  const [modelOverrideId, setModelOverrideId] = useState<string>();
  const [speechArtifacts, setSpeechArtifacts] = useState<
    Record<string, SpeechArtifact>
  >({});
  // Keyed per chat like the transcript, and for the same reason: a run settles
  // in the chat it started in, which is no longer necessarily the chat on
  // screen. A shared slot let a background run overwrite the visible queue and
  // the visible ratings.
  const queuedTurnsQuery = useQuery({
    queryKey: ["queuedTurns", activeChatId],
    queryFn: () => listQueuedTurns(activeChatId!),
    enabled: activeChatId !== undefined,
  });
  const messageFeedbackQuery = useQuery({
    queryKey: ["messageFeedback", activeChatId],
    queryFn: async () =>
      Object.fromEntries(
        (await listMessageFeedback(activeChatId!)).map((item) => [
          item.messageId,
          item,
        ]),
      ),
    enabled: activeChatId !== undefined,
  });
  const [contextPreview, setContextPreview] = useState<RunContextPreview>();
  const [contextPreviewError, setContextPreviewError] = useState<string>();
  const [isInspectingContext, setIsInspectingContext] = useState(false);
  const [error, setError] = useState<string>();
  const handledChatRemovalEventId = useRef<string | undefined>(undefined);
  // Streaming state is per chat and lives outside React, so a run that started
  // here keeps going while the user reads or writes somewhere else.
  const {
    activities: runActivities,
    citations,
    error: runError,
    handleCancel,
    isStreaming,
  } = useActiveRun(activeChatId);
  const {
    appendMessage,
    handleAttachmentRetention,
    handleDeleteMessage,
    handleRateMessage,
    restoreMessages,
    syncPersistedMessages,
  } = useChatMessageState({
    activeChatId,
    isStreaming,
    queryClient,
    setError,
  });
  const {
    activeAgent,
    agents,
    allMessages,
    chats,
    chatsTotal,
    chatExperience,
    hasMoreChats,
    isLoadingMoreChats,
    latestChatEvent,
    loadMoreChats,
    messages,
    models,
    providerOperationalSummary,
    providers,
    subject,
    tools,
    variantsByMessageId,
    workspace,
  } = useWorkspaceData(activeAgentId, {
    ...(activeChatId === undefined ? {} : { activeChatId }),
    ...(options.requestedAgentId === undefined
      ? {}
      : { requestedAgentId: options.requestedAgentId }),
  });
  const {
    clearPendingAttachments,
    documentAttachments,
    handleAttachExistingFile,
    handleAttachFiles,
    handleAttachImages,
    handleGenerateImages,
    handleRemoveDocumentAttachment,
    handleRemoveImageAttachment,
    imageAttachments,
    restorePendingAttachments,
  } = useWorkspaceAttachments({
    queryClient,
    setError,
    t,
    workspaceId: workspace?.id,
  });
  const {
    handleCreateProvider,
    handleSyncProvider,
    handleUpdateModelPricing,
    isCreatingProvider,
    isUpdatingModelPricing,
    syncingProviderId,
  } = useWorkspaceProviderActions({
    queryClient,
    setError,
  });
  // The assistant provides the default, while a chat can persist an explicit
  // model choice. A pending override also survives the first send while the
  // new chat row is being created.
  const activeChat = chats.find((chat) => chat.id === activeChatId);
  const selectedModelId = resolveChatModelSelection({
    assistantModelId: activeAgent?.baseModelId,
    chatModelId: activeChat?.modelId,
    overrideModelId: modelOverrideId,
  });
  const managedModelPreferencesQuery = useQuery({
    queryKey: ["managedModelPreferences", activeAgent?.id],
    queryFn: () => getManagedModelPreferences(activeAgent!.id),
    enabled: activeAgent !== undefined,
  });
  const activeVoiceProfileId =
    managedModelPreferencesQuery.data?.voiceProfileId ??
    activeAgent?.voiceProfileId;
  const {
    handleGenerateSpeech,
    handleTranscribeAudio,
    isGeneratingSpeech,
    isTranscribingVoice,
    speechMessageId,
  } = useWorkspaceVoiceActions({
    activeVoiceProfileId,
    refreshUsageControls,
    setDraft,
    setError,
    setSpeechArtifacts,
    t,
  });
  const toolExecution = useToolExecution(activeAgent, tools, setError);
  const {
    followQueuedRuns,
    handleBranchFromMessage,
    handleContinueResponse,
    handleEditAndResend,
    handleSubmit,
    regenerateLast,
    trackChatRun,
  } = useWorkspaceTurnActions({
    activeAgentId: activeAgent?.id,
    activeChatId,
    allMessages,
    autoTitleEnabled: chatExperience?.autoTitleEnabled ?? true,
    appendMessage,
    attachedUrls,
    clearPendingAttachments,
    documentAttachments,
    draft,
    imageAttachments,
    isStreaming,
    messages,
    ...(options.onChatSelection === undefined
      ? {}
      : { onChatCreated: options.onChatSelection }),
    queryClient,
    refreshUsageControls,
    restoreMessages,
    restorePendingAttachments,
    selectedModelId,
    setActiveChatId,
    setAttachedUrls,
    setDraft,
    setError,
    setIsDraftingNewChat,
    setTemporaryNextChat,
    syncPersistedMessages,
    t,
    temporaryNextChat,
    webSearchEnabled,
    workspaceId: workspace?.id,
  });
  const {
    deleteChat,
    handleAddUrl,
    handleCancelQueuedTurn,
    handleChatArchived,
    handleChatDeleted,
    handleNewChat: handleNewChatInternal,
    handleNewTemporaryChat: handleNewTemporaryChatInternal,
    handleSelectChat: handleSelectChatInternal,
    handleSelectModel,
    handleSelectVariant,
    handleWorkspaceArchived,
    renameChat,
  } = useWorkspaceChatActions({
    activeChatId,
    allMessages,
    followQueuedRuns,
    queryClient,
    setActiveAgentId,
    setActiveChatId,
    setAttachedUrls,
    setError,
    setIsDraftingNewChat,
    setModelOverrideId,
    setSpeechArtifacts,
    setTemporaryNextChat,
    syncPersistedMessages,
    t,
    trackChatRun,
    workspaceId: workspace?.id,
  });
  const handleSelectChat = async (chatId: string) => {
    setModelOverrideId(undefined);
    await handleSelectChatInternal(chatId);
    options.onChatSelection?.(chatId);
  };
  const handleNewChat = () => {
    setModelOverrideId(undefined);
    handleNewChatInternal();
    options.onChatSelection?.(undefined);
  };
  const handleNewTemporaryChat = () => {
    setModelOverrideId(undefined);
    handleNewTemporaryChatInternal();
    options.onChatSelection?.(undefined);
  };
  const firstChatId = chats[0]?.id;
  const requestedAgentId = options.requestedAgentId;
  const requestedChatId = options.requestedChatId;
  const resolvedActiveAgentId = activeAgent?.id;
  const selectChatFromEffect = useEffectEvent(
    async (chatId: string, notifySelection: boolean) => {
      setModelOverrideId(undefined);
      await handleSelectChatInternal(chatId);
      if (notifySelection) options.onChatSelection?.(chatId);
    },
  );
  const notifyAgentSelection = useEffectEvent((agentId: string) => {
    options.onAgentSelection?.(agentId);
  });
  const reconcileRemoteChatRemoval = useEffectEvent(async (chatId: string) => {
    await handleChatDeleted(chatId);
    options.onChatSelection?.(undefined);
  });

  useEffect(() => {
    if (requestedAgentId !== undefined) setActiveAgentId(requestedAgentId);
  }, [requestedAgentId]);

  useEffect(() => {
    const requestedChat = {
      activeChatId,
      isDraftingNewChat,
      requestedChatId,
    };
    if (!shouldApplyRequestedChat(requestedChat)) return;
    void selectChatFromEffect(requestedChat.requestedChatId, false).catch(
      (caught) =>
        setError(
          caught instanceof Error ? caught.message : "Unable to load chat.",
        ),
    );
  }, [activeChatId, isDraftingNewChat, requestedChatId]);

  useEffect(() => {
    setModelOverrideId(undefined);
  }, [activeAgent?.id]);

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
  }, [activeAgentId, activeChatId, resolvedActiveAgentId]);

  useEffect(() => {
    const key = `romeo:draft:${activeChatId ?? `new:${workspace?.id ?? "none"}`}`;
    const saved = localStorage.getItem(key);
    setDraft(saved ?? "");
  }, [activeChatId, workspace?.id]);

  useEffect(() => {
    const key = `romeo:draft:${activeChatId ?? `new:${workspace?.id ?? "none"}`}`;
    if (draft.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, draft);
  }, [activeChatId, draft, workspace?.id]);

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
      setError(
        caught instanceof Error ? caught.message : "Unable to load chat.",
      ),
    );
  }, [activeChatId, firstChatId, isDraftingNewChat, isStreaming]);

  async function handleInspectContext() {
    if (activeChatId === undefined || activeAgent === undefined) return;
    setIsInspectingContext(true);
    setContextPreviewError(undefined);
    try {
      setContextPreview(
        await inspectRunContext({
          chatId: activeChatId,
          agentId: activeAgent.id,
          ...(selectedModelId === undefined
            ? {}
            : { modelId: selectedModelId }),
          content: draft.trim() || "Continue the conversation.",
          fileIds: documentAttachments.map((item) => item.fileId),
          imageCount: imageAttachments.length,
          ...(webSearchEnabled ? { webSearch: true } : {}),
          ...(attachedUrls.length === 0 ? {} : { urls: attachedUrls }),
        }),
      );
    } catch (caught) {
      setContextPreviewError(
        caught instanceof Error ? caught.message : "Unable to inspect context.",
      );
    } finally {
      setIsInspectingContext(false);
    }
  }

  async function refreshUsageControls() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["usageEvents"] }),
      queryClient.invalidateQueries({ queryKey: ["usageSummary"] }),
      queryClient.invalidateQueries({ queryKey: ["usageAlerts"] }),
      queryClient.invalidateQueries({
        queryKey: ["providerOperationalSummary"],
      }),
      queryClient.invalidateQueries({ queryKey: ["quotas"] }),
    ]);
  }

  return {
    activeAgent,
    activeVoiceProfileId,
    activeAgentId,
    activeChatId,
    agents,
    chats,
    chatsTotal,
    chatExperience,
    citations,
    contextPreview,
    contextPreviewError,
    deleteChat,
    documentAttachments,
    draft,
    // A local failure is always the newer signal: every handler clears it
    // before acting, so a lingering provider error must not mask it.
    error: error ?? runError,
    handleCancel,
    handleCancelQueuedTurn,
    handleChatArchived,
    handleChatDeleted,
    handleWorkspaceArchived,
    handleCreateProvider,
    handleApproveTool: toolExecution.approvePendingTool,
    handleCancelToolApproval: toolExecution.cancelPendingTool,
    handleExecuteCalculator: toolExecution.handleExecuteCalculator,
    handleExecuteDateTime: toolExecution.handleExecuteDateTime,
    handleGenerateSpeech,
    handleBranchFromMessage,
    handleContinueResponse,
    handleDeleteMessage,
    handleInspectContext,
    handleAttachmentRetention,
    handleEditAndResend,
    handleAttachImages,
    handleAttachFiles,
    handleNewChat,
    handleNewTemporaryChat,
    handleAddUrl,
    handleRemoveUrl: (url: string) =>
      setAttachedUrls((current) => current.filter((item) => item !== url)),
    handleAttachExistingFile,
    handleGenerateImages,
    handleRemoveImageAttachment,
    handleRemoveDocumentAttachment,
    handleRateMessage,
    handleTranscriptionError: setError,
    handleTranscribeAudio,
    handleSelectChat,
    handleSelectModel,
    handleSelectVariant,
    handleSubmit,
    handleSyncProvider,
    handleUpdateModelPricing,
    isCreatingProvider,
    isExecutingTool: toolExecution.isExecutingTool,
    isGeneratingSpeech,
    isInspectingContext,
    hasMoreChats,
    isLoadingMoreChats,
    isTranscribingVoice,
    isUpdatingModelPricing,
    isStreaming,
    queuedTurns: queuedTurnsQuery.data ?? noQueuedTurns,
    loadMoreChats,
    attachedUrls,
    webSearchEnabled,
    setWebSearchEnabled,
    temporaryNextChat,
    imageAttachments,
    messages,
    messageFeedback: messageFeedbackQuery.data ?? noFeedback,
    models,
    pendingToolApproval: toolExecution.pendingApproval,
    providers,
    providerOperationalSummary,
    regenerateLast,
    renameChat,
    selectedModelId,
    setActiveAgentId: (agentId: string) => {
      setActiveAgentId(agentId);
      options.onAgentSelection?.(agentId);
    },
    setDraft,
    speechArtifacts,
    speechMessageId,
    subject,
    syncingProviderId,
    runActivities,
    toolResult: toolExecution.toolResult,
    tools,
    variantsByMessageId,
    workspace,
  };
}

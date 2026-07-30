import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import type {
  Message,
  MessageFeedbackState,
  SpeechArtifact,
} from "../features/types";
import { inspectRunContext, type RunContextPreview } from "../features/chat";
import { getManagedModelPreferences } from "../features/managed-models";
import type { QueuedChatTurn } from "../features/runs";
import { useLocale } from "../lib/i18n";
import { shouldAutoSelectChat } from "./chat-selection";
import { resolveChatModelSelection } from "./chat-model-selection";
import { useChatMessageState } from "./useChatMessageState";
import {
  useChatRunStream,
  type ChatCitation,
  type ChatRunActivity,
} from "./useChatRunStream";
import { useToolExecution } from "./useToolExecution";
import { useWorkspaceAttachments } from "./useWorkspaceAttachments";
import { useWorkspaceChatActions } from "./useWorkspaceChatActions";
import { useWorkspaceData } from "./useWorkspaceData";
import { useWorkspaceProviderActions } from "./useWorkspaceProviderActions";
import { useWorkspaceTurnActions } from "./useWorkspaceTurnActions";
import { useWorkspaceVoiceActions } from "./useWorkspaceVoiceActions";

const initialDraft = "";
export type {
  PendingDocumentAttachment,
  PendingImageAttachment,
} from "./useWorkspaceAttachments";

export type { ChatCitation, ChatRunActivity } from "./useChatRunStream";

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
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeAgentId, setActiveAgentId] = useState<string | undefined>(
    options.requestedAgentId,
  );
  const [activeChatId, setActiveChatId] = useState<string | undefined>(
    options.requestedChatId,
  );
  // Explicit intent: the user asked for a blank chat and there is no chat row
  // behind it yet. Distinguishes "New chat" from "the active chat vanished",
  // which look identical from activeChatId alone. See ./chat-selection.
  const [isDraftingNewChat, setIsDraftingNewChat] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [attachedUrls, setAttachedUrls] = useState<string[]>([]);
  const [temporaryNextChat, setTemporaryNextChat] = useState(false);
  const [queuedTurns, setQueuedTurns] = useState<QueuedChatTurn[]>([]);
  const [modelOverrideId, setModelOverrideId] = useState<string>();
  const [speechArtifacts, setSpeechArtifacts] = useState<
    Record<string, SpeechArtifact>
  >({});
  const [messageFeedback, setMessageFeedback] = useState<
    Record<string, MessageFeedbackState>
  >({});
  const [contextPreview, setContextPreview] = useState<RunContextPreview>();
  const [contextPreviewError, setContextPreviewError] = useState<string>();
  const [isInspectingContext, setIsInspectingContext] = useState(false);
  const [error, setError] = useState<string>();
  const {
    activeRunId,
    citations,
    consumeRunStream,
    handleCancel,
    isStreaming,
    resetRunPresentation,
    runActivities,
    setActiveRunId,
  } = useChatRunStream({ setError, setMessages, t });
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
    setError,
    setMessageFeedback,
    setMessages,
  });
  const {
    activeAgent,
    agents,
    chats,
    chatsTotal,
    chatExperience,
    hasMoreChats,
    isLoadingMoreChats,
    loadMoreChats,
    models,
    providerOperationalSummary,
    providers,
    subject,
    tools,
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
  } = useWorkspaceTurnActions({
    activeAgentId: activeAgent?.id,
    activeChatId,
    autoTitleEnabled: chatExperience?.autoTitleEnabled ?? true,
    appendMessage,
    attachedUrls,
    clearPendingAttachments,
    consumeRunStream,
    documentAttachments,
    draft,
    imageAttachments,
    isStreaming,
    messages,
    queryClient,
    refreshUsageControls,
    resetRunPresentation,
    restoreMessages,
    restorePendingAttachments,
    selectedModelId,
    setActiveChatId,
    setActiveRunId,
    setAttachedUrls,
    setDraft,
    setError,
    setIsDraftingNewChat,
    setMessages,
    setQueuedTurns,
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
    handleWorkspaceArchived,
    renameChat,
  } = useWorkspaceChatActions({
    activeChatId,
    appendMessage,
    consumeRunStream,
    followQueuedRuns,
    isStreaming,
    queryClient,
    setActiveAgentId,
    setActiveChatId,
    setActiveRunId,
    setAttachedUrls,
    setError,
    setIsDraftingNewChat,
    setMessages,
    setModelOverrideId,
    setQueuedTurns,
    setSpeechArtifacts,
    setTemporaryNextChat,
    syncPersistedMessages,
    t,
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

  useEffect(() => {
    if (options.requestedAgentId !== undefined)
      setActiveAgentId(options.requestedAgentId);
  }, [options.requestedAgentId]);

  useEffect(() => {
    if (options.requestedChatId !== undefined)
      setActiveChatId(options.requestedChatId);
  }, [options.requestedChatId]);

  useEffect(() => {
    setModelOverrideId(undefined);
  }, [activeAgent?.id]);

  useEffect(() => {
    if (
      activeChatId === undefined ||
      activeAgent === undefined ||
      activeAgentId === activeAgent.id
    )
      return;
    setActiveAgentId(activeAgent.id);
    options.onAgentSelection?.(activeAgent.id);
  }, [activeAgent?.id, activeAgentId, activeChatId]);

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
    void handleSelectChat(firstChatId).catch((caught) =>
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
    error,
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
    queuedTurns,
    loadMoreChats,
    attachedUrls,
    webSearchEnabled,
    setWebSearchEnabled,
    temporaryNextChat,
    imageAttachments,
    messages,
    messageFeedback,
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
    workspace,
  };
}

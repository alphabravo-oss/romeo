import { useQueryClient } from "@tanstack/react-query";
import { useLocale } from "../lib/i18n";
import { safeUserErrorMessage } from "../lib/safe-user-error";
import { useChatMessageState } from "./useChatMessageState";
import { useToolExecution } from "./useToolExecution";
import { useWorkspaceAttachments } from "./useWorkspaceAttachments";
import { useWorkspaceChatActions } from "./useWorkspaceChatActions";
import { useWorkspaceData } from "./useWorkspaceData";
import { useWorkspaceProviderActions } from "./useWorkspaceProviderActions";
import { useWorkspaceSelectionSync } from "./useWorkspaceSelectionSync";
import { useWorkspaceTurnActions } from "./useWorkspaceTurnActions";
import { useWorkspaceVoiceActions } from "./useWorkspaceVoiceActions";
import { useWorkspaceDraft } from "./useWorkspaceDraft";
import { useWorkspaceRuntimeState } from "./useWorkspaceRuntimeState";
import { useWorkspaceCompositionState } from "./useWorkspaceCompositionState";
import { useWorkspaceModelState } from "./useWorkspaceModelState";
import type { WorkspaceControllerOptions } from "./workspace-controller-types";
import { useReaderBranchSelection } from "./useReaderBranchSelection";
import { readerScopedBranchLeaf } from "./chat-selection";
import * as controllerOperations from "./workspace-controller-operations";

export function useWorkspaceController(
  options: WorkspaceControllerOptions = {},
) {
  const queryClient = useQueryClient();
  const { t } = useLocale();
  const {
    activeAgentId,
    activeChatId,
    agenticRagAvailable,
    agenticRagEnabled,
    agenticRagForced,
    attachedUrls,
    isDraftingNewChat,
    knowledgeBaseIdsOverride,
    modelOverrideId,
    reasoningMode,
    researchMode,
    routingMode,
    setActiveAgentId,
    setActiveChatId,
    setAgenticRagRequested,
    setAttachedUrls,
    setIsDraftingNewChat,
    setKnowledgeBaseIdsOverride,
    setModelOverrideId,
    setReasoningMode,
    setResearchMode,
    setRoutingMode,
    setSpeechArtifacts,
    setTemporaryNextChat,
    setWebSearchEnabled,
    speechArtifacts,
    temporaryNextChat,
    webSearchEnabled,
  } = useWorkspaceCompositionState(options.requestedAgentId);
  const {
    activities: runActivities,
    citations,
    error: runError,
    handleCancel,
    isStreaming,
    reasoning,
    toolCalls,
    wait: runWait,
    contextPreview,
    contextPreviewError,
    error,
    isInspectingContext,
    messageFeedback,
    queuedTurns,
    setContextPreview,
    setContextPreviewError,
    setError,
    setIsInspectingContext,
  } = useWorkspaceRuntimeState(activeChatId);
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
  const scopedLeafMessageId = readerScopedBranchLeaf({
    activeChatId,
    requestedChatId: options.requestedChatId,
    requestedLeafMessageId: options.requestedLeafMessageId,
  });
  const {
    activeAgent,
    agents,
    allMessages,
    branchLeafMessageId,
    chats,
    chatsTotal,
    chatExperience,
    hasMoreChats,
    hasOlderMessages,
    interfacePreferences,
    isLoadingMoreChats,
    isLoadingOlderMessages,
    latestChatEvent,
    loadMoreChats,
    loadOlderMessages,
    messagePageNeedsReset,
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
    ...(scopedLeafMessageId === undefined
      ? {}
      : { requestedLeafMessageId: scopedLeafMessageId }),
  });
  const selectSettledBranch = useReaderBranchSelection({
    activeChatId,
    branchLeafMessageId,
    invalidSelection:
      messagePageNeedsReset ||
      (options.requestedChatId !== undefined &&
        options.requestedChatId !== activeChatId),
    ...(options.onBranchSelection === undefined
      ? {}
      : { onBranchSelection: options.onBranchSelection }),
    requestedLeafMessageId: scopedLeafMessageId,
  });
  const { draft, setDraft } = useWorkspaceDraft({
    chatId: activeChatId,
    subjectId: subject?.id,
    workspaceId: workspace?.id,
  });
  const {
    clearPendingAttachments,
    documentAttachments,
    handleAttachExistingFile,
    handleAttachFiles,
    handleAttachImages,
    handleGenerateImages,
    handleCancelAttachment, handleMoveDocumentAttachment, handleMoveImageAttachment,
    handleRetryDocumentAttachment, handleSelectDocumentPage, handleRemoveDocumentAttachment, handleRemoveImageAttachment,
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
    setError,
  });
  const activeChat = chats.find((chat) => chat.id === activeChatId);
  const workspaceId = workspace?.id;
  const {
    activeVoiceProfileId,
    lastReplyModelId,
    modelDisplayNames,
    selectedModelId,
  } = useWorkspaceModelState({
    activeAgent,
    chatModelId: activeChat?.modelId,
    defaultModelId:
      workspaceId === undefined
        ? undefined
        : interfacePreferences?.defaultModelByWorkspace[workspaceId],
    lastModelId:
      workspaceId === undefined
        ? undefined
        : interfacePreferences?.lastModelByWorkspace[workspaceId],
    messages,
    modelOverrideId,
    models,
  });
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
    handleFollowUp,
    handleSubmit,
    regenerateLast,
    trackChatRun,
  } = useWorkspaceTurnActions({
    activeAgentId: activeAgent?.id,
    activeChatId,
    chats,
    allMessages,
    autoTitleEnabled: chatExperience?.autoTitleEnabled ?? true,
    appendMessage,
    attachedUrls,
    clearPendingAttachments,
    documentAttachments,
    draft,
    imageAttachments,
    isStreaming,
    ...(knowledgeBaseIdsOverride === undefined
      ? {}
      : { knowledgeBaseIdsOverride }),
    messages,
    onBranchSelection: selectSettledBranch,
    ...(options.onChatSelection === undefined
      ? {}
      : {
          onChatCreated: (chatId: string) =>
            options.onChatSelection?.(chatId, { replace: true }),
        }),
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
    agenticRagEnabled,
    reasoningMode,
    routingMode,
    researchMode,
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
    handleToggleDefaultModel,
    handleSelectVariant,
    handleWorkspaceArchived,
    renameChat,
  } = useWorkspaceChatActions({
    activeChatId,
    ...(options.onBranchSelection === undefined
      ? {}
      : {
          onBranchSelection: (leafMessageId: string) =>
            options.onBranchSelection?.(leafMessageId),
        }),
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
    const moved = chatId !== activeChatId;
    await handleSelectChatInternal(chatId);
    if (moved) options.onChatSelection?.(chatId);
  };
  const handleNewChat = () => {
    setModelOverrideId(undefined);
    const moved = activeChatId !== undefined;
    handleNewChatInternal();
    if (moved) options.onChatSelection?.(undefined);
  };
  const handleNewTemporaryChat = () => {
    setModelOverrideId(undefined);
    const moved = activeChatId !== undefined;
    handleNewTemporaryChatInternal();
    if (moved) options.onChatSelection?.(undefined);
  };
  useWorkspaceSelectionSync({
    activeAgentId,
    activeChatId,
    firstChatId: chats[0]?.id,
    handleChatDeleted,
    isDraftingNewChat,
    isStreaming,
    latestChatEvent,
    ...(options.onAgentSelection === undefined
      ? {}
      : { onAgentSelection: options.onAgentSelection }),
    ...(options.onChatSelection === undefined
      ? {}
      : { onChatSelection: options.onChatSelection }),
    requestedAgentId: options.requestedAgentId,
    requestedChatId: options.requestedChatId,
    resolvedActiveAgentId: activeAgent?.id,
    selectChat: handleSelectChatInternal,
    setActiveAgentId,
    setActiveChatId,
    setError,
    setIsDraftingNewChat,
    setModelOverrideId,
  });
  async function handleInspectContext() {
    if (activeChatId === undefined || activeAgent === undefined) return;
    setIsInspectingContext(true);
    setContextPreviewError(undefined);
    try {
      setContextPreview(
        await controllerOperations.inspectWorkspaceRunContext({
          chatId: activeChatId,
          agentId: activeAgent.id,
          modelId: selectedModelId,
          routingMode,
          researchMode,
          reasoningMode,
          content: draft.trim() || "Continue the conversation.",
          fileIds: documentAttachments.map((item) => item.fileId),
          imageCount: imageAttachments.length,
          webSearchEnabled,
          agenticRagEnabled,
          attachedUrls,
        }),
      );
    } catch (caught) {
      setContextPreviewError(
        safeUserErrorMessage(caught, t("unexpectedAsyncFailure")),
      );
    } finally {
      setIsInspectingContext(false);
    }
  }
  async function refreshUsageControls() {
    await controllerOperations.refreshWorkspaceUsageControls(queryClient);
  }
  async function handleCreateFeedbackEvalCase(messageId: string) {
    if (activeChatId === undefined || activeAgent === undefined) return;
    await controllerOperations.createFeedbackEvalCase({
      agentId: activeAgent.id,
      chatId: activeChatId,
      messageId,
      t,
    });
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
    handleCreateFeedbackEvalCase,
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
    handleCancelAttachment, handleMoveDocumentAttachment, handleMoveImageAttachment,
    handleRetryDocumentAttachment, handleSelectDocumentPage,
    handleRemoveImageAttachment, handleRemoveDocumentAttachment,
    handleRateMessage,
    handleTranscriptionError: setError,
    handleTranscribeAudio,
    handleSelectChat,
    handleSelectModel,
    handleToggleDefaultModel,
    handleSelectVariant,
    handleSubmit,
    handleSyncProvider,
    handleUpdateModelPricing,
    isCreatingProvider,
    isExecutingTool: toolExecution.isExecutingTool,
    isGeneratingSpeech,
    isInspectingContext,
    hasMoreChats,
    hasOlderMessages,
    isLoadingMoreChats,
    isLoadingOlderMessages,
    isTranscribingVoice,
    isUpdatingModelPricing,
    isStreaming,
    queuedTurns,
    loadMoreChats,
    loadOlderMessages,
    attachedUrls,
    knowledgeBaseIdsOverride,
    setKnowledgeBaseIdsOverride,
    webSearchEnabled,
    setWebSearchEnabled,
    agenticRagAvailable,
    agenticRagForced,
    agenticRagEnabled,
    setAgenticRagRequested,
    routingMode,
    setRoutingMode,
    reasoningMode,
    setReasoningMode,
    researchMode,
    setResearchMode,
    temporaryNextChat,
    imageAttachments,
    messages,
    messageFeedback,
    models,
    modelDisplayNames,
    lastReplyModelId,
    defaultModelId:
      workspaceId === undefined
        ? undefined
        : interfacePreferences?.defaultModelByWorkspace[workspaceId],
    pendingToolApproval: toolExecution.pendingApproval,
    providers,
    providerOperationalSummary,
    reasoning,
    handleFollowUp,
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
    runWait,
    toolCalls,
    toolResult: toolExecution.toolResult,
    tools,
    variantsByMessageId,
    workspace,
  };
}

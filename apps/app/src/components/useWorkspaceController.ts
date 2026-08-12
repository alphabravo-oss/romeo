import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { listMessageFeedback } from "../features";
import type { MessageFeedbackState, SpeechArtifact } from "../features/types";
import { inspectRunContext, type RunContextPreview } from "../features/chat";
import { getManagedModelPreferences } from "../features/managed-models";
import { getAgenticRagSettings } from "../features/knowledge";
import { listQueuedTurns, type QueuedChatTurn } from "../features/runs";
import { useLocale } from "../lib/i18n";
import {
  lastAssistantModelId,
  resolveChatModelSelection,
} from "./chat-model-selection";
import { useActiveRun } from "./useActiveRun";
import { useChatMessageState } from "./useChatMessageState";
import { useToolExecution } from "./useToolExecution";
import { useWorkspaceAttachments } from "./useWorkspaceAttachments";
import { useWorkspaceChatActions } from "./useWorkspaceChatActions";
import { useWorkspaceData } from "./useWorkspaceData";
import { useWorkspaceProviderActions } from "./useWorkspaceProviderActions";
import { useWorkspaceSelectionSync } from "./useWorkspaceSelectionSync";
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

export type {
  ChatCitation,
  ChatReasoning,
  ChatRunActivity,
  ChatRunWait,
} from "../lib/run-registry";

export function useWorkspaceController(
  options: {
    onAgentSelection?: (agentId: string) => void;
    onChatSelection?: (
      chatId: string | undefined,
      options?: { replace: boolean },
    ) => void;
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
  const [agenticRagRequested, setAgenticRagRequested] = useState(false);
  const agenticSettingsQuery = useQuery({
    queryKey: ["agenticRagSettings"],
    queryFn: getAgenticRagSettings,
  });
  const agenticRagAvailable = agenticSettingsQuery.data?.enabled === true;
  const agenticRagForced =
    agenticRagAvailable && agenticSettingsQuery.data?.userMode === "required";
  const agenticRagEnabled = agenticRagForced || agenticRagRequested;
  /**
   * Per-turn knowledge override. `undefined` keeps the custom model's bindings;
   * an array (including empty) is sent as `knowledgeBaseIds` on startRun.
   */
  const [knowledgeBaseIdsOverride, setKnowledgeBaseIdsOverride] = useState<
    string[] | undefined
  >();
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
  // Streaming state is per chat and lives outside React, so a run that started
  // here keeps going while the user reads or writes somewhere else. Everything
  // the transcript needs comes out of this one subscription: a second
  // useActiveRun elsewhere in the tree would key off its own idea of the active
  // chat, and during a switch the two disagree for a render.
  const {
    activities: runActivities,
    citations,
    error: runError,
    handleCancel,
    isStreaming,
    reasoning,
    toolCalls,
    wait: runWait,
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
    interfacePreferences,
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
  // Chat model wins when set; otherwise user default, last-used, then curated
  // base. A pending override also survives the first send while a new chat is
  // being created.
  const activeChat = chats.find((chat) => chat.id === activeChatId);
  const workspaceId = workspace?.id;
  const selectedModelId = resolveChatModelSelection({
    assistantModelId: activeAgent?.baseModelId,
    chatModelId: activeChat?.modelId,
    defaultModelId:
      workspaceId === undefined
        ? undefined
        : interfacePreferences?.defaultModelByWorkspace[workspaceId],
    lastModelId:
      workspaceId === undefined
        ? undefined
        : interfacePreferences?.lastModelByWorkspace[workspaceId],
    overrideModelId: modelOverrideId,
  });
  const lastReplyModelId = lastAssistantModelId(messages);
  const modelDisplayNames = useMemo(
    () =>
      Object.fromEntries(
        models.map((model) => [model.id, model.displayName] as const),
      ),
    [models],
  );
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
    ...(options.onChatSelection === undefined
      ? {}
      : {
          // Replaces: the chat row is minted by the first send, so this URL
          // describes the blank entry the user is already standing on. Pushing
          // would put an unreachable "no chat yet" state behind them.
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
  // The three direct selections below all PUSH: they are the navigations Back
  // and Forward are supposed to walk. Each one first checks that the selection
  // actually moves, because re-opening the chat already on screen (or pressing
  // "New chat" on an already-blank one) leaves the URL identical, and stacking
  // duplicate entries would make Back need several presses to go anywhere.
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
          ...(agenticRagEnabled ? { agenticRag: true } : {}),
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
    isLoadingMoreChats,
    isTranscribingVoice,
    isUpdatingModelPricing,
    isStreaming,
    queuedTurns: queuedTurnsQuery.data ?? noQueuedTurns,
    loadMoreChats,
    attachedUrls,
    knowledgeBaseIdsOverride,
    setKnowledgeBaseIdsOverride,
    webSearchEnabled,
    setWebSearchEnabled,
    agenticRagAvailable,
    agenticRagForced,
    agenticRagEnabled,
    setAgenticRagRequested,
    temporaryNextChat,
    imageAttachments,
    messages,
    messageFeedback: messageFeedbackQuery.data ?? noFeedback,
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

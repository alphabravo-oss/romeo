import { Button } from "@romeo/ui";
import ArrowDown from "lucide-react/dist/esm/icons/arrow-down.mjs";
import type { DragEvent } from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ArtifactContext, type ArtifactBinding } from "../lib/markdown";
import { useStickToBottom } from "../lib/use-stick-to-bottom";
import { TRANSCRIPT_FEED_ID } from "./TranscriptWindow";
import { ArtifactPane } from "./ArtifactPane";
import { collectArtifacts, findArtifactVersion } from "./chat-artifacts";
import { ChatMessages } from "./ChatMessages";
import { ChatSessionBar } from "./ChatSessionBar";
import { ChatComposer } from "./ChatComposer";
import { defaultStarterSuggestions } from "./chat-suggestions";
import { ContextInspector } from "./ContextInspector";
import { isDragOverlayVisible, nextDragDepth } from "./drag-depth";
import { QueuedTurnGhosts } from "./QueuedTurnGhosts";
import {
  canPerformChatWriteAction,
  streamRecoveryLabel,
  streamRecoveryPhase,
} from "./chat-enterprise";
import { useChatUiPreferences } from "../lib/chat-ui-preferences";
import { useLocale } from "../lib/i18n";
import type { ChatPanelProps } from "./chat-panel-types";
import { ChatEmptyState } from "./ChatEmptyState";
import {
  getActiveRun,
  RUN_STREAM_MAX_RECONNECT_ATTEMPTS,
} from "../lib/run-registry";
import {
  captureTranscriptPrependAnchor,
  restoreTranscriptPrependAnchor,
  type TranscriptPrependAnchor,
} from "../lib/transcript-prepend-anchor";

import "../styles/app-artifacts.css";
import "../styles/app-composer-extras.css";
import "../styles/app-content.css";
import "../styles/app-message-detail.css";

export function ChatPanel({
  activeVoiceProfileId,
  activation,
  activeAgent,
  activeChatId,
  chatTitle,
  nextTurnAuthorName,
  transcriptAuthorName,
  citations,
  attachedUrls,
  canInspectContext,
  contextPreview,
  contextPreviewError,
  draft,
  documentAttachments,
  error,
  imageAttachments,
  isGeneratingSpeech,
  isInspectingContext,
  isStreaming,
  hasOlderMessages,
  isLoadingOlderMessages,
  isTemporaryChat,
  queuedTurns,
  isTranscribingVoice,
  knowledgeBaseIdsOverride,
  messages,
  messageFeedback,
  models,
  modelDisplayNames,
  providers,
  promptSuggestions,
  selectedModelId,
  systemPrompt,
  defaultModelId,
  lastReplyModelId,
  customModels,
  selectedCustomModelId,
  onSelectCustomModel,
  onSelectModel,
  onToggleDefaultModel,
  webSearchEnabled,
  agenticRagAvailable,
  agenticRagForced,
  agenticRagEnabled,
  routingMode,
  researchMode,
  reasoningMode,
  workspaceId,
  onAttachFiles,
  onAttachExistingFile,
  onAddUrl,
  onCancel,
  onCancelQueuedTurn,
  onBranch,
  onContinue,
  onCreateFeedbackEvalCase,
  onDeleteMessage,
  onAttachmentRetention,
  onDraftChange,
  onGenerateImages,
  onGenerateSpeech,
  onInspectContext,
  onLoadOlderMessages,
  onKnowledgeBaseIdsChange,
  onEditAndResend,
  onRateMessage,
  onRegenerate,
  onRegenerateWith,
  onFollowUp,
  regenerateModels,
  onShareChat,
  onExportChatMarkdown,
  onCancelAttachment, onMoveDocumentAttachment, onMoveImageAttachment,
  onRemoveImageAttachment, onRemoveDocumentAttachment,
  onRetryDocumentAttachment, onSelectDocumentPage,
  onRemoveUrl,
  onSelectVariant,
  onToggleWebSearch,
  onToggleAgenticRag,
  onRoutingModeChange,
  onResearchModeChange,
  onReasoningModeChange,
  onTranscribeAudio,
  onTranscriptionError,
  onSubmit,
  reasoning,
  runActivities,
  runWait,
  chatAccess = "owner",
  legalHoldUntil,
  onOpenSourceChat,
  speechArtifacts,
  speechMessageId,
  toolCalls,
  variantsByMessageId,
}: ChatPanelProps) {
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);
  const { t } = useLocale();
  const chatUi = useChatUiPreferences();
  const streamingAssistantMessageId =
    getActiveRun(activeChatId)?.assistantMessageId;
  const effectivePromptSuggestions = useMemo(
    () =>
      promptSuggestions.length > 0
        ? promptSuggestions
        : defaultStarterSuggestions(t),
    [promptSuggestions, t],
  );
  const [contextInspectorOpen, setContextInspectorOpen] = useState(false);
  // Structural message changes drive the normal effect. The isolated active
  // row calls notifyContentChanged after each frame without rerendering here.
  const {
    atBottom,
    notifyContentChanged,
    ref: conversationRef,
    scrollToBottom,
  } = useStickToBottom(messages, { enabled: chatUi.stickToBottom });
  const getConversationElement = useCallback(
    () => conversationRef.current,
    [conversationRef],
  );
  const pendingPrepend = useRef<TranscriptPrependAnchor | undefined>(undefined);
  const handleLoadOlderMessages = useCallback(async () => {
    const viewport = conversationRef.current;
    pendingPrepend.current = captureTranscriptPrependAnchor(viewport);
    try {
      await onLoadOlderMessages();
    } catch (error) {
      pendingPrepend.current = undefined;
      throw error;
    }
  }, [conversationRef, onLoadOlderMessages]);
  useLayoutEffect(() => {
    const viewport = conversationRef.current;
    const snapshot = pendingPrepend.current;
    if (viewport === null || snapshot === undefined) return;
    return restoreTranscriptPrependAnchor(viewport, snapshot, () => {
      pendingPrepend.current = undefined;
    });
  }, [conversationRef, messages]);
  // Artifacts are derived from committed transcript boundaries. The growing
  // row is deliberately excluded from this whole-transcript scan until settle.
  const artifacts = useMemo(
    () => collectArtifacts(messages, citations.length),
    [citations, messages],
  );
  const [artifactState, setArtifactState] = useState<{
    key: string;
    version: number;
  }>();
  const openArtifact = artifacts.find(
    (artifact) => artifact.key === artifactState?.key,
  );
  const artifactVersion = Math.min(
    artifactState?.version ?? 0,
    (openArtifact?.versions.length ?? 1) - 1,
  );
  const artifactBinding = useMemo<ArtifactBinding | undefined>(
    () =>
      artifacts.length === 0
        ? undefined
        : {
            lookup: (messageId, offset) =>
              findArtifactVersion(artifacts, messageId, offset),
            open: (key, version) => setArtifactState({ key, version }),
            shownKey: openArtifact?.key,
            shownVersion:
              openArtifact === undefined ? undefined : artifactVersion,
          },
    [artifactVersion, artifacts, openArtifact],
  );

  useEffect(() => {
    const reset = () => {
      dragDepth.current = nextDragDepth(dragDepth.current, "reset");
      setDragActive(false);
    };
    window.addEventListener("dragend", reset);
    window.addEventListener("drop", reset);
    return () => {
      window.removeEventListener("dragend", reset);
      window.removeEventListener("drop", reset);
    };
  }, []);

  const dropTargetProps = {
    onDragEnter: (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      dragDepth.current = nextDragDepth(dragDepth.current, "enter");
      setDragActive(isDragOverlayVisible(dragDepth.current));
    },
    onDragOver: (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
    },
    onDragLeave: () => {
      dragDepth.current = nextDragDepth(dragDepth.current, "leave");
      setDragActive(isDragOverlayVisible(dragDepth.current));
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      dragDepth.current = nextDragDepth(dragDepth.current, "reset");
      setDragActive(false);
      if (!canPerformChatWriteAction(chatAccess, "attach")) return;
      onAttachFiles(Array.from(event.dataTransfer.files));
    },
  };

  const composer = (
    <ChatComposer
      attachedUrls={attachedUrls}
      chatAccess={chatAccess}
      canInspectContext={canInspectContext}
      contextPreview={contextPreview}
      documentAttachments={documentAttachments}
      draft={draft}
      error={error}
      imageAttachments={imageAttachments}
      isInspectingContext={isInspectingContext}
      isStreaming={isStreaming}
      isTemporaryChat={isTemporaryChat}
      isTranscribingVoice={isTranscribingVoice}
      knowledgeBaseIdsOverride={knowledgeBaseIdsOverride}
      messageCount={messages.length}
      messages={messages}
      models={models}
      systemPrompt={systemPrompt}
      defaultModelId={defaultModelId}
      lastReplyModelId={lastReplyModelId}
      onAddUrl={onAddUrl}
      onAttachExistingFile={onAttachExistingFile}
      onAttachFiles={onAttachFiles}
      onCancel={onCancel}
      onDraftChange={onDraftChange}
      onGenerateImages={onGenerateImages}
      onInspectContext={() => {
        setContextInspectorOpen(true);
        onInspectContext();
      }}
      onKnowledgeBaseIdsChange={onKnowledgeBaseIdsChange}
      onCancelAttachment={onCancelAttachment} onMoveDocumentAttachment={onMoveDocumentAttachment} onMoveImageAttachment={onMoveImageAttachment} onRemoveDocumentAttachment={onRemoveDocumentAttachment} onRemoveImageAttachment={onRemoveImageAttachment} onRetryDocumentAttachment={onRetryDocumentAttachment} onSelectDocumentPage={onSelectDocumentPage}
      onRemoveUrl={onRemoveUrl}
      {...(customModels === undefined ? {} : { customModels })}
      {...(selectedCustomModelId === undefined
        ? {}
        : { selectedCustomModelId })}
      {...(onSelectCustomModel === undefined ? {} : { onSelectCustomModel })}
      onSelectModel={onSelectModel}
      onToggleDefaultModel={onToggleDefaultModel}
      onSubmit={onSubmit}
      onToggleWebSearch={onToggleWebSearch}
      onToggleAgenticRag={onToggleAgenticRag}
      onRoutingModeChange={onRoutingModeChange}
      onResearchModeChange={onResearchModeChange}
      onReasoningModeChange={onReasoningModeChange}
      agenticRagAvailable={agenticRagAvailable}
      agenticRagForced={agenticRagForced}
      agenticRagEnabled={agenticRagEnabled}
      routingMode={routingMode}
      researchMode={researchMode}
      reasoningMode={reasoningMode}
      onTranscribeAudio={onTranscribeAudio}
      onTranscriptionError={onTranscriptionError}
      providers={providers}
      selectedModelId={selectedModelId}
      enterToSend={chatUi.enterToSend}
      webSearchEnabled={webSearchEnabled}
      workspaceId={workspaceId}
    />
  );

  if (messages.length === 0) {
    return (
      <ChatEmptyState
        activation={activation}
        chatId={isTemporaryChat ? undefined : activeChatId}
        composer={composer}
        contextPreview={contextPreview}
        contextPreviewError={contextPreviewError}
        dragActive={dragActive}
        dropTargetProps={dropTargetProps}
        isInspectingContext={isInspectingContext}
        nextTurnAuthorName={nextTurnAuthorName}
        onCloseContext={() => setContextInspectorOpen(false)}
        onDraftChange={onDraftChange}
        showContextInspector={contextInspectorOpen}
        showStarterPrompts={chatUi.showStarterPrompts}
        suggestions={effectivePromptSuggestions}
      />
    );
  }

  return (
    <section
      className={`rm-chat-panel ${openArtifact === undefined ? "" : "with-artifact"} ${dragActive ? "drag-active" : ""}`}
      {...dropTargetProps}
    >
      {dragActive ? (
        <div className="rm-drop-overlay">{t("dropFilesToAttach")}</div>
      ) : null}
      <ChatSessionBar
        chatId={activeChatId}
        chatTitle={chatTitle}
        isTemporaryChat={isTemporaryChat}
        {...(legalHoldUntil === undefined ? {} : { legalHoldUntil })}
        modelDisplayName={
          nextTurnAuthorName ??
          (selectedModelId === undefined
            ? undefined
            : modelDisplayNames[selectedModelId])
        }
        onExportMarkdown={
          canPerformChatWriteAction(chatAccess, "export")
            ? onExportChatMarkdown
            : onExportChatMarkdown
        }
        {...(onOpenSourceChat === undefined ? {} : { onOpenSourceChat })}
        onShare={
          canPerformChatWriteAction(chatAccess, "share")
            ? onShareChat
            : undefined
        }
        onSearchNavigate={onSelectVariant}
      />
      {(() => {
        const phase = streamRecoveryPhase({
          isStreaming,
          reconnectAttempts: runWait?.reconnectAttempts ?? 0,
          maxReconnectAttempts:
            runWait?.maxReconnectAttempts ?? RUN_STREAM_MAX_RECONNECT_ATTEMPTS,
          hasTerminalError: false,
        });
        const label = streamRecoveryLabel(phase);
        if (phase !== "reconnecting" && phase !== "failed") return null;
        return (
          <div
            className={`rm-stream-recovery rm-stream-recovery--${phase}`}
            role="status"
          >
            {label || t("streamReconnecting")}
          </div>
        );
      })()}
      <ArtifactContext.Provider value={artifactBinding}>
        <div className="rm-conversation" ref={conversationRef}>
          {hasOlderMessages ? (
            <>
              <Button
                aria-controls={TRANSCRIPT_FEED_ID}
                aria-describedby="load-earlier-messages-description"
                aria-busy={isLoadingOlderMessages}
                disabled={isLoadingOlderMessages}
                onClick={() => void handleLoadOlderMessages()}
                type="button"
                variant="ghost"
              >
                {isLoadingOlderMessages
                  ? t("loading")
                  : t("loadEarlierMessages")}
              </Button>
              <span className="sr-only" id="load-earlier-messages-description">
                {t("loadEarlierMessagesDescription")}
              </span>
            </>
          ) : null}
          <ChatMessages
            activeVoiceProfileId={activeVoiceProfileId}
            authorName={transcriptAuthorName}
            citations={citations}
            feedback={messageFeedback}
            getScrollElement={getConversationElement}
            isGeneratingSpeech={isGeneratingSpeech}
            isStreaming={isStreaming}
            messages={messages}
            modelDisplayNames={modelDisplayNames}
            selectedModelId={selectedModelId}
            onBranch={onBranch}
            onContinue={onContinue}
            {...(onCreateFeedbackEvalCase === undefined
              ? {}
              : { onCreateFeedbackEvalCase })}
            onDelete={onDeleteMessage}
            onAttachmentRetention={onAttachmentRetention}
            onEditAndResend={onEditAndResend}
            onGenerateSpeech={onGenerateSpeech}
            onRate={onRateMessage}
            onRegenerate={onRegenerate}
            onRegenerateWith={onRegenerateWith}
            onFollowUp={onFollowUp}
            regenerateModels={regenerateModels}
            onSelectVariant={onSelectVariant}
            onStreamingContentChange={notifyContentChanged}
            reasoning={reasoning}
            runActivities={runActivities}
            runWait={runWait}
            showContinueButton={chatUi.showContinueButton}
            showFollowUps={chatUi.showFollowUps}
            showMessageModelLabel={chatUi.showMessageModelLabel}
            showMessageTimestamps={chatUi.showMessageTimestamps}
            showRunStatus={chatUi.showRunStatus}
            chatAccess={chatAccess}
            agentName={activeAgent?.name}
            speechArtifacts={speechArtifacts}
            speechMessageId={speechMessageId}
            streamingAssistantMessageId={streamingAssistantMessageId}
            toolCalls={toolCalls}
            variantsByMessageId={variantsByMessageId}
          />
          <QueuedTurnGhosts onCancel={onCancelQueuedTurn} turns={queuedTurns} />
          {/* Unmounted rather than faded out while the reader is already at the
            bottom: a transparent-but-present button still takes a tab stop and
            still reads out to a screen reader as an action that, from here,
            does nothing. */}
          {atBottom ? null : (
            <Button
              aria-label={t("scrollToLatest")}
              className="rm-scroll-to-bottom"
              onClick={scrollToBottom}
              size="icon"
              variant="secondary"
            >
              <ArrowDown aria-hidden="true" size={16} />
            </Button>
          )}
        </div>
      </ArtifactContext.Provider>

      {composer}
      {openArtifact === undefined ? null : (
        <ArtifactPane
          artifact={openArtifact}
          onClose={() => setArtifactState(undefined)}
          onSelectVersion={(version) =>
            setArtifactState({ key: openArtifact.key, version })
          }
          version={artifactVersion}
        />
      )}
      {contextInspectorOpen ? (
        <ContextInspector
          chatId={isTemporaryChat ? undefined : activeChatId}
          error={contextPreviewError}
          loading={isInspectingContext}
          onClose={() => setContextInspectorOpen(false)}
          preview={contextPreview}
        />
      ) : null}
    </section>
  );
}

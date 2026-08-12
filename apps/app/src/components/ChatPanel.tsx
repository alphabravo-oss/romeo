import { Button } from "@romeo/ui";
import ArrowDown from "lucide-react/dist/esm/icons/arrow-down.mjs";
import BotMessageSquare from "lucide-react/dist/esm/icons/bot-message-square.mjs";
import Sparkles from "lucide-react/dist/esm/icons/sparkles.mjs";
import Zap from "lucide-react/dist/esm/icons/zap.mjs";
import type { DragEvent, FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import type {
  BaseModel,
  Message,
  MessageFeedbackState,
  Provider,
  SpeechArtifact,
} from "../features/types";
import type { Agent, AgentGalleryItem } from "../features/managed-models";
import type { RunContextPreview } from "../features/chat";
import type { ChatSuggestion } from "../features/chat-experience";
import type { QueuedChatTurn } from "../features/runs";
import { ArtifactContext, type ArtifactBinding } from "../lib/markdown";
import { useStickToBottom } from "../lib/use-stick-to-bottom";
import { ArtifactPane } from "./ArtifactPane";
import { collectArtifacts, findArtifactVersion } from "./chat-artifacts";
import { ChatMessages } from "./ChatMessages";
import { ChatSessionBar } from "./ChatSessionBar";
import { ChatComposer } from "./ChatComposer";
import { suggestionSubtitle } from "./chat-suggestions";
import { ContextInspector } from "./ContextInspector";
import { isDragOverlayVisible, nextDragDepth } from "./drag-depth";
import { QueuedTurnGhosts } from "./QueuedTurnGhosts";
import type { MessageVariants } from "./message-tree";
import type { ChatRunWait } from "../lib/run-registry";
import type { ChatToolCall } from "../lib/run-tool-calls";
import type {
  ChatCitation,
  ChatReasoning,
  ChatRunActivity,
  PendingDocumentAttachment,
  PendingImageAttachment,
} from "./useWorkspaceController";
import type { FileObject } from "../features/files";
import {
  canPerformChatWriteAction,
  streamRecoveryLabel,
  streamRecoveryPhase,
} from "./chat-enterprise";
import { useChatUiPreferences } from "../lib/chat-ui-preferences";
import { useLocale } from "../lib/i18n";
import { RUN_STREAM_MAX_RECONNECT_ATTEMPTS } from "../lib/run-registry";

export function ChatPanel({
  activeVoiceProfileId,
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
  workspaceId,
  onAttachFiles,
  onAttachExistingFile,
  onAddUrl,
  onCancel,
  onCancelQueuedTurn,
  onBranch,
  onContinue,
  onDeleteMessage,
  onAttachmentRetention,
  onDraftChange,
  onGenerateImages,
  onGenerateSpeech,
  onInspectContext,
  onKnowledgeBaseIdsChange,
  onEditAndResend,
  onRateMessage,
  onRegenerate,
  onRegenerateWith,
  onFollowUp,
  regenerateModels,
  onShareChat,
  onExportChatMarkdown,
  onRemoveImageAttachment,
  onRemoveDocumentAttachment,
  onRemoveUrl,
  onSelectVariant,
  onToggleWebSearch,
  onToggleAgenticRag,
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
}: {
  activeVoiceProfileId: string | undefined;
  activeAgent: Pick<Agent, "avatarUrl" | "icon" | "name"> | undefined;
  activeChatId: string | undefined;
  chatTitle: string | undefined;
  /**
   * Selected model name for the next turn: custom model when one is picked,
   * otherwise the base model. Heads an empty chat; undefined is a neutral title.
   */
  nextTurnAuthorName: string | undefined;
  /**
   * Custom model name for rows already on screen, when it differs from the
   * base model. Undefined when the base model is the identity.
   */
  transcriptAuthorName: string | undefined;
  citations: ChatCitation[];
  attachedUrls: string[];
  canInspectContext: boolean;
  contextPreview: RunContextPreview | undefined;
  contextPreviewError: string | undefined;
  draft: string;
  documentAttachments: PendingDocumentAttachment[];
  error: string | undefined;
  imageAttachments: PendingImageAttachment[];
  isGeneratingSpeech: boolean;
  isInspectingContext: boolean;
  isStreaming: boolean;
  isTemporaryChat: boolean;
  queuedTurns: QueuedChatTurn[];
  isTranscribingVoice: boolean;
  knowledgeBaseIdsOverride: string[] | undefined;
  messages: Message[];
  messageFeedback: Record<string, MessageFeedbackState>;
  /** Every model known to the workspace; the composer filters to enabled ones. */
  models: BaseModel[];
  modelDisplayNames: Record<string, string>;
  providers: Provider[];
  promptSuggestions: ChatSuggestion[];
  /** The model that will answer the next message in this chat. */
  selectedModelId: string | undefined;
  systemPrompt: string | undefined;
  defaultModelId: string | undefined;
  /** Model on the latest assistant reply in this branch, if known. */
  lastReplyModelId: string | undefined;
  customModels?: AgentGalleryItem[];
  selectedCustomModelId?: string;
  onSelectCustomModel?: (agentId: string, baseModelId: string) => void;
  onSelectModel: (modelId: string) => void;
  onToggleDefaultModel: (modelId: string) => void;
  webSearchEnabled: boolean;
  agenticRagAvailable: boolean;
  agenticRagForced: boolean;
  agenticRagEnabled: boolean;
  workspaceId: string | undefined;
  onAttachFiles: (files: File[]) => void;
  onAttachExistingFile: (file: FileObject) => void;
  onAddUrl: (url: string) => void;
  onCancel: () => void;
  onCancelQueuedTurn: (turn: QueuedChatTurn) => void;
  onBranch: (messageId: string) => void;
  onContinue: () => void;
  onDeleteMessage: (messageId: string) => void;
  onAttachmentRetention: (
    messageId: string,
    attachmentId: string,
    retainedInContext: boolean,
  ) => void;
  onDraftChange: (value: string) => void;
  onGenerateImages: (input: {
    modelId: string;
    prompt: string;
    size: "1024x1024" | "1024x1536" | "1536x1024";
  }) => void;
  onGenerateSpeech: (messageId: string) => void;
  onInspectContext: () => void;
  onKnowledgeBaseIdsChange: (knowledgeBaseIds: string[] | undefined) => void;
  onEditAndResend: (messageId: string, content: string) => Promise<boolean>;
  onRateMessage: (
    messageId: string,
    rating: "negative" | "none" | "positive",
    reasonCode?: string,
  ) => void;
  chatAccess?: "owner" | "write" | "read";
  legalHoldUntil?: string | undefined;
  onOpenSourceChat?: ((sourceChatId: string) => void) | undefined;
  onRegenerate: () => void;
  onRegenerateWith: (input: {
    modelId?: string;
    mode?: "again" | "shorter";
  }) => void;
  onFollowUp: (prompt: string) => void;
  regenerateModels: Array<{ id: string; label: string }>;
  onShareChat: (() => void) | undefined;
  onExportChatMarkdown: (() => void) | undefined;
  onRemoveImageAttachment: (attachmentId: string) => void;
  onRemoveDocumentAttachment: (attachmentId: string) => void;
  onRemoveUrl: (url: string) => void;
  onSelectVariant: (messageId: string) => void;
  onToggleWebSearch: (enabled: boolean) => void;
  onToggleAgenticRag: (enabled: boolean) => void;
  onTranscribeAudio: (blob: Blob) => Promise<void>;
  onTranscriptionError: (message: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  reasoning: ChatReasoning | undefined;
  runActivities: ChatRunActivity[];
  runWait: ChatRunWait | undefined;
  speechArtifacts: Record<string, SpeechArtifact>;
  speechMessageId: string | undefined;
  toolCalls: ChatToolCall[];
  variantsByMessageId: Record<string, MessageVariants>;
}) {
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);
  const { t } = useLocale();
  const chatUi = useChatUiPreferences();
  const [contextInspectorOpen, setContextInspectorOpen] = useState(false);
  // Re-runs on every token: messages is a new array each delta, so the effect
  // fires throughout the stream, not just on message boundaries.
  const {
    atBottom,
    ref: conversationRef,
    scrollToBottom,
  } = useStickToBottom(messages, { enabled: chatUi.stickToBottom });
  // The messages go in as they are: `messages` is a new array on every delta,
  // but the rows it holds are the same objects a delta did not touch, and that
  // is what collectArtifacts caches on. Copying them into fresh source objects
  // here is what defeated it -- every token re-prepared and re-scanned the whole
  // conversation, and handed every code block in the transcript a new context.
  const artifacts = useMemo(
    () => collectArtifacts(messages, citations.length),
    [citations, messages],
  );
  const [artifactState, setArtifactState] = useState<{
    key: string;
    version: number;
  }>();
  // Derived, not synchronised: switching chat or flipping a variant drops the
  // artifact out of the list and closes the pane with no effect to run.
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
      onRemoveDocumentAttachment={onRemoveDocumentAttachment}
      onRemoveImageAttachment={onRemoveImageAttachment}
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
      agenticRagAvailable={agenticRagAvailable}
      agenticRagForced={agenticRagForced}
      agenticRagEnabled={agenticRagEnabled}
      onTranscribeAudio={onTranscribeAudio}
      onTranscriptionError={onTranscriptionError}
      providers={providers}
      selectedModelId={selectedModelId}
      enterToSend={chatUi.enterToSend}
      webSearchEnabled={webSearchEnabled}
      workspaceId={workspaceId}
    />
  );

  // Empty state (Open WebUI default landing): centered, logo inline with the
  // model name, composer floating in the middle, suggestions below.
  if (messages.length === 0) {
    return (
      <section
        className={`rm-chat-panel rm-chat-panel-empty ${dragActive ? "drag-active" : ""}`}
        {...dropTargetProps}
      >
        {dragActive ? (
          <div className="rm-drop-overlay">{t("dropFilesToAttach")}</div>
        ) : null}
        <div className="rm-placeholder">
          <div className="rm-placeholder-inner">
            <div className="rm-placeholder-head">
              <div className="rm-placeholder-logo">
                <BotMessageSquare aria-hidden="true" size={20} />
              </div>
              <div className="rm-placeholder-copy">
                <h1 className="rm-placeholder-title">
                  {nextTurnAuthorName ?? t("newChat")}
                </h1>
                <p className="rm-placeholder-subtitle">{t("prompt")}</p>
              </div>
            </div>
            {composer}
            {chatUi.showStarterPrompts && promptSuggestions.length > 0 ? (
              <div className="rm-suggestions">
                <div className="rm-suggestions-label">
                  <Zap aria-hidden="true" size={12} />
                  <span>{t("suggested")}</span>
                </div>
                <div className="rm-suggestion-grid">
                  {promptSuggestions.slice(0, 6).map((suggestion, index) => {
                    const subtitle = suggestionSubtitle(suggestion.prompt);
                    return (
                      <Button
                        className="rm-suggestion"
                        key={`${suggestion.title}-${index}`}
                        onClick={() => onDraftChange(suggestion.prompt)}
                        title={suggestion.title}
                        type="button"
                      >
                        <Sparkles aria-hidden="true" size={16} />
                        <span className="rm-suggestion-text">
                          <span className="rm-suggestion-title">
                            {suggestion.title}
                          </span>
                          {subtitle === "" ||
                          subtitle === suggestion.title ? null : (
                            <span className="rm-suggestion-subtitle">
                              {subtitle}
                            </span>
                          )}
                        </span>
                      </Button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </div>
        {contextInspectorOpen ? (
          <ContextInspector
            {...(contextPreviewError === undefined
              ? {}
              : { error: contextPreviewError })}
            loading={isInspectingContext}
            onClose={() => setContextInspectorOpen(false)}
            {...(contextPreview === undefined
              ? {}
              : { preview: contextPreview })}
          />
        ) : null}
      </section>
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
          <ChatMessages
            activeVoiceProfileId={activeVoiceProfileId}
            authorName={transcriptAuthorName}
            citations={citations}
            feedback={messageFeedback}
            isGeneratingSpeech={isGeneratingSpeech}
            isStreaming={isStreaming}
            messages={messages}
            modelDisplayNames={modelDisplayNames}
            selectedModelId={selectedModelId}
            onBranch={onBranch}
            onContinue={onContinue}
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
          {...(contextPreviewError === undefined
            ? {}
            : { error: contextPreviewError })}
          loading={isInspectingContext}
          onClose={() => setContextInspectorOpen(false)}
          {...(contextPreview === undefined ? {} : { preview: contextPreview })}
        />
      ) : null}
    </section>
  );
}

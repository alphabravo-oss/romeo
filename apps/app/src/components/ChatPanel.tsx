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
import type { RunContextPreview } from "../features/chat";
import type { ChatSuggestion } from "../features/chat-experience";
import type { QueuedChatTurn } from "../features/runs";
import { ArtifactContext, type ArtifactBinding } from "../lib/markdown";
import { useStickToBottom } from "../lib/use-stick-to-bottom";
import { ArtifactPane } from "./ArtifactPane";
import { collectArtifacts, findArtifactVersion } from "./chat-artifacts";
import { ChatMessages } from "./ChatMessages";
import { ChatComposer } from "./ChatComposer";
import { suggestionSubtitle } from "./chat-suggestions";
import { ContextInspector } from "./ContextInspector";
import { isDragOverlayVisible, nextDragDepth } from "./drag-depth";
import { QueuedTurnGhosts } from "./QueuedTurnGhosts";
import type { MessageVariants } from "./message-tree";
import type { ChatToolCall } from "../lib/run-tool-calls";
import type {
  ChatCitation,
  ChatReasoning,
  ChatRunActivity,
  PendingDocumentAttachment,
  PendingImageAttachment,
} from "./useWorkspaceController";
import type { FileObject } from "../features/files";
import { useLocale } from "../lib/i18n";

export function ChatPanel({
  activeVoiceProfileId,
  agentName,
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
  messages,
  messageFeedback,
  models,
  providers,
  promptSuggestions,
  selectedModelId,
  onSelectModel,
  webSearchEnabled,
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
  onEditAndResend,
  onRateMessage,
  onRegenerate,
  onRemoveImageAttachment,
  onRemoveDocumentAttachment,
  onRemoveUrl,
  onSelectVariant,
  onToggleWebSearch,
  onTranscribeAudio,
  onTranscriptionError,
  onSubmit,
  reasoning,
  runActivities,
  speechArtifacts,
  speechMessageId,
  toolCalls,
  variantsByMessageId,
}: {
  activeVoiceProfileId: string | undefined;
  agentName: string;
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
  messages: Message[];
  messageFeedback: Record<string, MessageFeedbackState>;
  /** Every model known to the workspace; the composer filters to enabled ones. */
  models: BaseModel[];
  providers: Provider[];
  promptSuggestions: ChatSuggestion[];
  /** The model that will answer the next message in this chat. */
  selectedModelId: string | undefined;
  onSelectModel: (modelId: string) => void;
  webSearchEnabled: boolean;
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
  onEditAndResend: (messageId: string, content: string) => Promise<boolean>;
  onRateMessage: (
    messageId: string,
    rating: "negative" | "none" | "positive",
  ) => void;
  onRegenerate: () => void;
  onRemoveImageAttachment: (attachmentId: string) => void;
  onRemoveDocumentAttachment: (attachmentId: string) => void;
  onRemoveUrl: (url: string) => void;
  onSelectVariant: (messageId: string) => void;
  onToggleWebSearch: (enabled: boolean) => void;
  onTranscribeAudio: (blob: Blob) => Promise<void>;
  onTranscriptionError: (message: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  reasoning: ChatReasoning | undefined;
  runActivities: ChatRunActivity[];
  speechArtifacts: Record<string, SpeechArtifact>;
  speechMessageId: string | undefined;
  toolCalls: ChatToolCall[];
  variantsByMessageId: Record<string, MessageVariants>;
}) {
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);
  const { t } = useLocale();
  const [contextInspectorOpen, setContextInspectorOpen] = useState(false);
  // Re-runs on every token: messages is a new array each delta, so the effect
  // fires throughout the stream, not just on message boundaries.
  const {
    atBottom,
    ref: conversationRef,
    scrollToBottom,
  } = useStickToBottom(messages);
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
      onAttachFiles(Array.from(event.dataTransfer.files));
    },
  };

  const composer = (
    <ChatComposer
      attachedUrls={attachedUrls}
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
      messageCount={messages.length}
      models={models}
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
      onRemoveDocumentAttachment={onRemoveDocumentAttachment}
      onRemoveImageAttachment={onRemoveImageAttachment}
      onRemoveUrl={onRemoveUrl}
      onSelectModel={onSelectModel}
      onSubmit={onSubmit}
      onToggleWebSearch={onToggleWebSearch}
      onTranscribeAudio={onTranscribeAudio}
      onTranscriptionError={onTranscriptionError}
      providers={providers}
      selectedModelId={selectedModelId}
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
              <h1 className="rm-placeholder-title">{agentName}</h1>
            </div>
            {composer}
            {promptSuggestions.length > 0 ? (
              <div className="rm-suggestions">
                <div className="rm-suggestions-label">
                  <Zap aria-hidden="true" size={12} />
                  <span>{t("suggested")}</span>
                </div>
                <div className="rm-suggestion-grid">
                  {promptSuggestions.map((suggestion, index) => {
                    const subtitle = suggestionSubtitle(suggestion.prompt);
                    return (
                      <Button
                        className="rm-suggestion"
                        key={`${suggestion.title}-${index}`}
                        onClick={() => onDraftChange(suggestion.prompt)}
                        title={suggestion.title}
                        type="button"
                      >
                        {/* One glyph for every card: picking a themed one meant
                            matching English keywords, so two of the three
                            shipped locales got the neutral fallback anyway. */}
                        <Sparkles aria-hidden="true" size={16} />
                        <span className="rm-suggestion-text">
                          <span className="rm-suggestion-title">
                            {suggestion.title}
                          </span>
                          {/* The prompt itself, so the card says what pressing
                              it will actually ask — not a second label. */}
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
      <ArtifactContext.Provider value={artifactBinding}>
        <div className="rm-conversation" ref={conversationRef}>
          <ChatMessages
            activeVoiceProfileId={activeVoiceProfileId}
            agentName={agentName}
            citations={citations}
            feedback={messageFeedback}
            isGeneratingSpeech={isGeneratingSpeech}
            isStreaming={isStreaming}
            messages={messages}
            onBranch={onBranch}
            onContinue={onContinue}
            onDelete={onDeleteMessage}
            onAttachmentRetention={onAttachmentRetention}
            onEditAndResend={onEditAndResend}
            onGenerateSpeech={onGenerateSpeech}
            onRate={onRateMessage}
            onRegenerate={onRegenerate}
            onSelectVariant={onSelectVariant}
            reasoning={reasoning}
            runActivities={runActivities}
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

/**
 * Composer-scoped model picker: which model answers the *next* message in
 * this chat. Mirrors ModelSelector's trigger/menu/click-outside pattern, but
 * lists enabled models rather than agents, and is styled to sit quietly among
 * the composer's other muted icon buttons instead of the top bar.
 */

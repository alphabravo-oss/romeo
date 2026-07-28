import { Button } from "@romeo/ui";
import BotMessageSquare from "lucide-react/dist/esm/icons/bot-message-square.mjs";
import Zap from "lucide-react/dist/esm/icons/zap.mjs";
import type { DragEvent, FormEvent } from "react";
import { useState } from "react";

import type {
  BaseModel,
  Message,
  MessageFeedbackState,
  Provider,
  SpeechArtifact,
} from "../features/types";
import type { RunContextPreview } from "../features/chat";
import type { QueuedChatTurn } from "../features/runs";
import { useStickToBottom } from "../lib/use-stick-to-bottom";
import { ChatMessages } from "./ChatMessages";
import { ChatComposer } from "./ChatComposer";
import { ContextInspector } from "./ContextInspector";
import type {
  ChatCitation,
  ChatRunActivity,
  PendingDocumentAttachment,
  PendingImageAttachment,
} from "./useWorkspaceController";
import type { FileObject } from "../features/files";
import { useLocale } from "../lib/i18n";

const promptSuggestions = [
  { title: "Draft a secure rollout plan", subtitle: "for Milestone 1" },
  { title: "Summarize workspace risks", subtitle: "across agents and data" },
  { title: "Create an operator checklist", subtitle: "for go-live readiness" },
];

export function ChatPanel({
  activeVoiceProfileId,
  agentName,
  canOverrideModel,
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
  selectedModelId,
  webSearchEnabled,
  workspaceId,
  onSelectModel,
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
  onToggleWebSearch,
  onTranscribeAudio,
  onTranscriptionError,
  onSubmit,
  runActivities,
  speechArtifacts,
  speechMessageId,
}: {
  activeVoiceProfileId: string | undefined;
  agentName: string;
  canOverrideModel: boolean;
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
  /**
   * The model that will answer the next message: the caller's override if
   * one is selected, otherwise the active agent's published baseModelId.
   * Undefined only while the active agent hasn't loaded yet.
   */
  selectedModelId: string | undefined;
  webSearchEnabled: boolean;
  workspaceId: string | undefined;
  onSelectModel: (modelId: string) => void;
  onAttachFiles: (files: File[]) => void;
  onAttachExistingFile: (file: FileObject) => void;
  onAddUrl: (url: string) => void;
  onCancel: () => void;
  onCancelQueuedTurn: (turnId: string) => void;
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
  onEditAndResend: (messageId: string, content: string) => void;
  onRateMessage: (
    messageId: string,
    rating: "negative" | "none" | "positive",
  ) => void;
  onRegenerate: () => void;
  onRemoveImageAttachment: (attachmentId: string) => void;
  onRemoveDocumentAttachment: (attachmentId: string) => void;
  onRemoveUrl: (url: string) => void;
  onToggleWebSearch: (enabled: boolean) => void;
  onTranscribeAudio: (blob: Blob) => Promise<void>;
  onTranscriptionError: (message: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  runActivities: ChatRunActivity[];
  speechArtifacts: Record<string, SpeechArtifact>;
  speechMessageId: string | undefined;
}) {
  const [dragActive, setDragActive] = useState(false);
  const { t } = useLocale();
  const [contextInspectorOpen, setContextInspectorOpen] = useState(false);
  // Re-runs on every token: messages is a new array each delta, so the effect
  // fires throughout the stream, not just on message boundaries.
  const conversationRef = useStickToBottom(messages);

  const dropTargetProps = {
    onDragEnter: (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      setDragActive(true);
    },
    onDragOver: (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (event.currentTarget === event.target) setDragActive(false);
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      setDragActive(false);
      onAttachFiles(Array.from(event.dataTransfer.files));
    },
  };

  const composer = (
    <ChatComposer
      attachedUrls={attachedUrls}
      canInspectContext={canInspectContext}
      canOverrideModel={canOverrideModel}
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
      onCancelQueuedTurn={onCancelQueuedTurn}
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
      queuedTurns={queuedTurns}
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
            <div className="rm-suggestions">
              <div className="rm-suggestions-label">
                <Zap aria-hidden="true" size={12} />
                <span>{t("suggested")}</span>
              </div>
              <div className="rm-suggestion-grid">
                {promptSuggestions.map((suggestion) => (
                  <Button
                    className="rm-suggestion"
                    key={suggestion.title}
                    onClick={() => onDraftChange(suggestion.title)}
                    type="button"
                  >
                    <span className="rm-suggestion-title">
                      {suggestion.title}
                    </span>
                    <span className="rm-suggestion-sub">
                      {suggestion.subtitle}
                    </span>
                  </Button>
                ))}
              </div>
            </div>
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
      className={`rm-chat-panel ${dragActive ? "drag-active" : ""}`}
      {...dropTargetProps}
    >
      {dragActive ? (
        <div className="rm-drop-overlay">{t("dropFilesToAttach")}</div>
      ) : null}
      <div className="rm-conversation" ref={conversationRef}>
        <ChatMessages
          activeVoiceProfileId={activeVoiceProfileId}
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
          runActivities={runActivities}
          speechArtifacts={speechArtifacts}
          speechMessageId={speechMessageId}
        />
      </div>

      {composer}
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

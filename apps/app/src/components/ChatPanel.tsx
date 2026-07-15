import ArrowUp from "lucide-react/dist/esm/icons/arrow-up.mjs";
import BotMessageSquare from "lucide-react/dist/esm/icons/bot-message-square.mjs";
import Copy from "lucide-react/dist/esm/icons/copy.mjs";
import ImagePlus from "lucide-react/dist/esm/icons/image-plus.mjs";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.mjs";
import Square from "lucide-react/dist/esm/icons/square.mjs";
import Volume2 from "lucide-react/dist/esm/icons/volume-2.mjs";
import X from "lucide-react/dist/esm/icons/x.mjs";
import Zap from "lucide-react/dist/esm/icons/zap.mjs";
import type { FormEvent, KeyboardEvent } from "react";
import { useRef } from "react";

import type { Message, SpeechArtifact } from "../api/types";
import { Markdown } from "../lib/markdown";
import { useStickToBottom } from "../lib/use-stick-to-bottom";
import type { PendingImageAttachment } from "./useWorkspaceController";
import { VoiceInputButton } from "./VoiceInputButton";

const promptSuggestions = [
  { title: "Draft a secure rollout plan", subtitle: "for Milestone 1" },
  { title: "Summarize workspace risks", subtitle: "across agents and data" },
  { title: "Create an operator checklist", subtitle: "for go-live readiness" },
];

export function ChatPanel({
  activeVoiceProfileId,
  agentName,
  draft,
  error,
  imageAttachments,
  isGeneratingSpeech,
  isStreaming,
  isTranscribingVoice,
  messages,
  onAttachImage,
  onCancel,
  onDraftChange,
  onGenerateSpeech,
  onRegenerate,
  onRemoveImageAttachment,
  onTranscribeAudio,
  onTranscriptionError,
  onSubmit,
  speechArtifacts,
  speechMessageId,
}: {
  activeVoiceProfileId: string | undefined;
  agentName: string;
  draft: string;
  error: string | undefined;
  imageAttachments: PendingImageAttachment[];
  isGeneratingSpeech: boolean;
  isStreaming: boolean;
  isTranscribingVoice: boolean;
  messages: Message[];
  onAttachImage: (file: File | undefined) => void;
  onCancel: () => void;
  onDraftChange: (value: string) => void;
  onGenerateSpeech: (messageId: string) => void;
  onRegenerate: () => void;
  onRemoveImageAttachment: (attachmentId: string) => void;
  onTranscribeAudio: (blob: Blob) => Promise<void>;
  onTranscriptionError: (message: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  speechArtifacts: Record<string, SpeechArtifact>;
  speechMessageId: string | undefined;
}) {
  function handleDraftKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  // Re-runs on every token: messages is a new array each delta, so the effect
  // fires throughout the stream, not just on message boundaries.
  const conversationRef = useStickToBottom(messages);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function handleComposerSubmit(event: FormEvent<HTMLFormElement>) {
    onSubmit(event);
    // The value is cleared but the inline height persists; reset it so the
    // composer collapses back to one row.
    if (textareaRef.current !== null)
      textareaRef.current.style.height = "auto";
  }

  const composer = (
    <form className="rm-composer-wrap" onSubmit={handleComposerSubmit}>
        <label className="sr-only" htmlFor="prompt">
          Message
        </label>
        {imageAttachments.length > 0 ? (
          <div className="rm-pending-attachments">
            {imageAttachments.map((attachment) => (
              <div className="rm-pending-attachment" key={attachment.id}>
                <img alt={attachment.fileName} src={attachment.previewUrl} />
                <span className="truncate">{attachment.fileName}</span>
                <button
                  aria-label={`Remove ${attachment.fileName}`}
                  disabled={isStreaming}
                  onClick={() => onRemoveImageAttachment(attachment.id)}
                  title={`Remove ${attachment.fileName}`}
                  type="button"
                >
                  <X aria-hidden="true" size={12} />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="rm-composer">
          <textarea
            disabled={isStreaming}
            id="prompt"
            onChange={(event) => onDraftChange(event.currentTarget.value)}
            onInput={(event) => {
              // ponytail: replace this whole handler with `field-sizing: content` in
              // app.css once Safari/Firefox support is broad enough. Until then CSS
              // cannot measure content, so the height comes from scrollHeight.
              const el = event.currentTarget;
              el.style.height = "auto"; // reset first, or it can only ever grow
              el.style.height = `${el.scrollHeight}px`;
            }}
            onKeyDown={handleDraftKeyDown}
            placeholder={
              messages.length === 0
                ? "How can I help you today?"
                : "Send a message"
            }
            ref={textareaRef}
            rows={1}
            value={draft}
          />
          <div className="rm-composer-actions">
            <label
              className={`rm-icon-button ${isStreaming ? "disabled" : ""}`}
              htmlFor="chat-image-attachment"
              title="Attach image"
            >
              <ImagePlus aria-hidden="true" size={17} />
              <span className="sr-only">Attach image</span>
            </label>
            <input
              accept="image/png,image/jpeg,image/gif,image/webp"
              className="sr-only"
              disabled={isStreaming}
              id="chat-image-attachment"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                onAttachImage(file);
              }}
              type="file"
            />
            <VoiceInputButton
              disabled={isStreaming}
              isTranscribing={isTranscribingVoice}
              onAudio={onTranscribeAudio}
              onError={onTranscriptionError}
            />
            {isStreaming ? (
              <button
                aria-label="Stop response"
                className="rm-icon-button stop"
                onClick={onCancel}
                title="Stop response"
                type="button"
              >
                <Square aria-hidden="true" size={15} />
              </button>
            ) : (
              <button
                aria-label="Send message"
                className="rm-send-button"
                disabled={draft.trim() === "" && imageAttachments.length === 0}
                title="Send message"
                type="submit"
              >
                <ArrowUp aria-hidden="true" size={16} />
              </button>
            )}
          </div>
        </div>
        {error ? <div className="rm-composer-error">{error}</div> : null}
      </form>
  );

  // Empty state (Open WebUI default landing): centered, logo inline with the
  // model name, composer floating in the middle, suggestions below.
  if (messages.length === 0) {
    return (
      <section className="rm-chat-panel rm-chat-panel-empty">
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
                <span>Suggested</span>
              </div>
              <div className="rm-suggestion-grid">
                {promptSuggestions.map((suggestion) => (
                  <button
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
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="rm-chat-panel">
      <div className="rm-conversation" ref={conversationRef}>
        <div className="rm-message-list">
          {messages.map((message, index) => {
            const speechArtifact = speechArtifacts[message.id];
            const isAssistant = message.role === "assistant";

            const attachments =
              message.attachments && message.attachments.length > 0 ? (
                <div className="rm-message-attachments">
                  {message.attachments.map((attachment) => (
                    <div className="rm-attachment-tile" key={attachment.id}>
                      {attachment.previewUrl ? (
                        <img
                          alt={attachment.fileName}
                          src={attachment.previewUrl}
                        />
                      ) : null}
                      <div className="truncate">{attachment.fileName}</div>
                    </div>
                  ))}
                </div>
              ) : null;

            if (!isAssistant) {
              return (
                <article className="rm-message-row user" key={message.id}>
                  <div className="rm-message-body">
                    <div className="rm-message-content">{message.content}</div>
                    {attachments}
                  </div>
                </article>
              );
            }

            const isThinking =
              message.content.length === 0 && isStreaming;
            return (
              <article className="rm-message-row assistant" key={message.id}>
                <div className="rm-message-avatar">H</div>
                <div className="rm-message-body">
                  <div className="rm-message-heading">
                    <span>Romeo</span>
                  </div>
                  <div className="rm-message-content">
                    {isThinking ? (
                      <span className="rm-skeleton" />
                    ) : (
                      <Markdown content={message.content} />
                    )}
                  </div>
                  {attachments}
                  {speechArtifact ? (
                    <div className="rm-speech-artifact">
                      <span>{formatSpeechArtifact(speechArtifact)}</span>
                      {speechArtifact.playbackUrl ? (
                        <audio
                          controls
                          preload="metadata"
                          src={speechArtifact.playbackUrl}
                        />
                      ) : null}
                    </div>
                  ) : null}
                  {!isThinking ? (
                    <div className="rm-message-actions">
                      <button
                        aria-label="Copy"
                        className="rm-message-tool"
                        onClick={() =>
                          void navigator.clipboard.writeText(message.content)
                        }
                        title="Copy"
                        type="button"
                      >
                        <Copy aria-hidden="true" size={16} />
                      </button>
                      <button
                        aria-label="Read aloud"
                        className="rm-message-tool"
                        disabled={
                          isStreaming ||
                          activeVoiceProfileId === undefined ||
                          (isGeneratingSpeech &&
                            speechMessageId === message.id)
                        }
                        onClick={() => onGenerateSpeech(message.id)}
                        title="Read aloud"
                        type="button"
                      >
                        <Volume2 aria-hidden="true" size={16} />
                      </button>
                      {!isStreaming && index === messages.length - 1 ? (
                        <button
                          aria-label="Regenerate response"
                          className="rm-message-tool"
                          onClick={onRegenerate}
                          title="Regenerate response"
                          type="button"
                        >
                          <RefreshCw aria-hidden="true" size={16} />
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </div>

      {composer}
    </section>
  );
}

function formatSpeechArtifact(artifact: SpeechArtifact): string {
  if (artifact.durationMs === undefined) return artifact.contentType;
  return `${artifact.contentType} · ${Math.round(artifact.durationMs / 1000)}s`;
}

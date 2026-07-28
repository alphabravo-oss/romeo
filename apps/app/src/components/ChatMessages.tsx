import { Input, Textarea, Button } from "@romeo/ui";
import BotMessageSquare from "lucide-react/dist/esm/icons/bot-message-square.mjs";
import Check from "lucide-react/dist/esm/icons/check.mjs";
import Copy from "lucide-react/dist/esm/icons/copy.mjs";
import GitBranch from "lucide-react/dist/esm/icons/git-branch.mjs";
import Pencil from "lucide-react/dist/esm/icons/pencil.mjs";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.mjs";
import ThumbsDown from "lucide-react/dist/esm/icons/thumbs-down.mjs";
import ThumbsUp from "lucide-react/dist/esm/icons/thumbs-up.mjs";
import Trash2 from "lucide-react/dist/esm/icons/trash-2.mjs";
import User from "lucide-react/dist/esm/icons/user.mjs";
import Volume2 from "lucide-react/dist/esm/icons/volume-2.mjs";
import { memo, useState } from "react";

import type {
  Message,
  MessageAttachment,
  MessageFeedbackState,
  SpeechArtifact,
} from "../features/types";
import { Markdown } from "../lib/markdown";
import { useLocale } from "../lib/i18n";
import { formatDateTime } from "../lib/locale-format";
import type { ChatCitation, ChatRunActivity } from "./useWorkspaceController";
import {
  CitationList,
  formatSpeechArtifact,
  RunActivityList,
} from "./ChatMessageMetadata";
import { FormDialog } from "./FormDialog";

export const ChatMessages = memo(function ChatMessages({
  activeVoiceProfileId,
  citations,
  feedback,
  isGeneratingSpeech,
  isStreaming,
  messages,
  onBranch,
  onAttachmentRetention,
  onContinue,
  onDelete,
  onEditAndResend,
  onGenerateSpeech,
  onRate,
  onRegenerate,
  runActivities,
  speechArtifacts,
  speechMessageId,
}: {
  activeVoiceProfileId: string | undefined;
  citations: ChatCitation[];
  feedback: Record<string, MessageFeedbackState>;
  isGeneratingSpeech: boolean;
  isStreaming: boolean;
  messages: Message[];
  onBranch: (messageId: string) => void;
  onAttachmentRetention: (
    messageId: string,
    attachmentId: string,
    retainedInContext: boolean,
  ) => void;
  onContinue: () => void;
  onDelete: (messageId: string) => void;
  onEditAndResend: (messageId: string, content: string) => void;
  onGenerateSpeech: (messageId: string) => void;
  onRate: (messageId: string, rating: "negative" | "none" | "positive") => void;
  onRegenerate: () => void;
  runActivities: ChatRunActivity[];
  speechArtifacts: Record<string, SpeechArtifact>;
  speechMessageId: string | undefined;
}) {
  const { locale, t } = useLocale();
  const [editingId, setEditingId] = useState<string>();
  const [editValue, setEditValue] = useState("");
  const [copiedId, setCopiedId] = useState<string>();
  const [previewAttachment, setPreviewAttachment] =
    useState<MessageAttachment>();

  function copy(message: Message) {
    void navigator.clipboard.writeText(message.content);
    setCopiedId(message.id);
    window.setTimeout(() => setCopiedId(undefined), 1_500);
  }

  return (
    <>
      <div className="rm-message-list">
        {messages.map((message, index) => {
          const isAssistant = message.role === "assistant";
          const isLast = index === messages.length - 1;
          const isThinking =
            isAssistant && message.content.length === 0 && isStreaming;
          const artifact = speechArtifacts[message.id];
          const messageFeedback = feedback[message.id];
          const attachments = (
            <MessageAttachments
              message={message}
              onRetentionChange={onAttachmentRetention}
              onPreview={setPreviewAttachment}
            />
          );

          if (!isAssistant) {
            const editing = editingId === message.id;
            return (
              <article className="rm-message-row user" key={message.id}>
                <div className="rm-message-body">
                  {editing ? (
                    <div className="rm-message-edit">
                      <Textarea
                        aria-label={t("editResend")}
                        autoFocus
                        onChange={(event) =>
                          setEditValue(event.currentTarget.value)
                        }
                        rows={Math.min(
                          12,
                          Math.max(3, editValue.split("\n").length),
                        )}
                        value={editValue}
                      />
                      <div className="rm-message-edit-actions">
                        <Button
                          onClick={() => setEditingId(undefined)}
                          type="button"
                        >
                          {t("cancel")}
                        </Button>
                        <Button
                          className="primary"
                          disabled={editValue.trim().length === 0}
                          onClick={() => {
                            onEditAndResend(message.id, editValue);
                            setEditingId(undefined);
                          }}
                          type="button"
                        >
                          {t("saveSubmit")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="rm-message-content">
                      <Markdown content={message.content} />
                    </div>
                  )}
                  {attachments}
                  {editing ? null : (
                    <MessageActions>
                      <Action
                        label={
                          copiedId === message.id ? t("copied") : t("copy")
                        }
                        onClick={() => copy(message)}
                      >
                        {copiedId === message.id ? (
                          <Check size={15} />
                        ) : (
                          <Copy size={15} />
                        )}
                      </Action>
                      <Action
                        label={t("editResend")}
                        onClick={() => {
                          setEditingId(message.id);
                          setEditValue(message.content);
                        }}
                      >
                        <Pencil size={15} />
                      </Action>
                      <Action
                        label={t("branch")}
                        onClick={() => onBranch(message.id)}
                      >
                        <GitBranch size={15} />
                      </Action>
                      <Action
                        label={t("deleteMessage")}
                        onClick={() => onDelete(message.id)}
                      >
                        <Trash2 size={15} />
                      </Action>
                    </MessageActions>
                  )}
                </div>
                <div className="rm-message-avatar user">
                  <User aria-hidden="true" size={16} />
                </div>
              </article>
            );
          }

          return (
            <article className="rm-message-row assistant" key={message.id}>
              <div className="rm-message-avatar">
                <BotMessageSquare aria-hidden="true" size={16} />
              </div>
              <div className="rm-message-body">
                <div className="rm-message-heading">
                  <span>Romeo</span>
                </div>
                <div className="rm-message-content">
                  {isThinking ? (
                    <span className="rm-skeleton" />
                  ) : (
                    <Markdown
                      content={message.content}
                      streaming={isLast && isStreaming}
                    />
                  )}
                </div>
                {isLast && isStreaming ? (
                  <RunActivityList activities={runActivities} />
                ) : null}
                {(message.citations?.length ??
                  (isLast ? citations.length : 0)) > 0 ? (
                  <CitationList citations={message.citations ?? citations} />
                ) : null}
                {attachments}
                {artifact ? (
                  <div className="rm-speech-artifact">
                    <span>{formatSpeechArtifact(artifact)}</span>
                    {artifact.playbackUrl ? (
                      <audio
                        controls
                        preload="metadata"
                        src={artifact.playbackUrl}
                      />
                    ) : null}
                  </div>
                ) : null}
                {isThinking ? null : (
                  <>
                    <MessageActions>
                      <Action
                        label={
                          copiedId === message.id ? t("copied") : t("copy")
                        }
                        onClick={() => copy(message)}
                      >
                        {copiedId === message.id ? (
                          <Check size={15} />
                        ) : (
                          <Copy size={15} />
                        )}
                      </Action>
                      <Action
                        active={messageFeedback?.rating === "positive"}
                        label={t("goodResponse")}
                        onClick={() =>
                          onRate(
                            message.id,
                            messageFeedback?.rating === "positive"
                              ? "none"
                              : "positive",
                          )
                        }
                      >
                        <ThumbsUp size={15} />
                      </Action>
                      <Action
                        active={messageFeedback?.rating === "negative"}
                        label={t("poorResponse")}
                        onClick={() =>
                          onRate(
                            message.id,
                            messageFeedback?.rating === "negative"
                              ? "none"
                              : "negative",
                          )
                        }
                      >
                        <ThumbsDown size={15} />
                      </Action>
                      <Action
                        disabled={
                          isStreaming ||
                          activeVoiceProfileId === undefined ||
                          (isGeneratingSpeech && speechMessageId === message.id)
                        }
                        label={t("readAloud")}
                        onClick={() => onGenerateSpeech(message.id)}
                      >
                        <Volume2 size={15} />
                      </Action>
                      <Action
                        label={t("branch")}
                        onClick={() => onBranch(message.id)}
                      >
                        <GitBranch size={15} />
                      </Action>
                      <Action
                        label={t("deleteMessage")}
                        onClick={() => onDelete(message.id)}
                      >
                        <Trash2 size={15} />
                      </Action>
                      {!isStreaming && isLast ? (
                        <Action label={t("regenerate")} onClick={onRegenerate}>
                          <RefreshCw size={15} />
                        </Action>
                      ) : null}
                    </MessageActions>
                    {!isStreaming && isLast ? (
                      <Button
                        className="rm-continue-button"
                        onClick={onContinue}
                        type="button"
                      >
                        {t("continue")}
                      </Button>
                    ) : null}
                  </>
                )}
                <div className="rm-message-meta" suppressHydrationWarning>
                  {formatDateTime(message.createdAt, locale)}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      <FormDialog
        open={previewAttachment !== undefined}
        title={previewAttachment?.fileName ?? t("sourceDocument")}
        onClose={() => setPreviewAttachment(undefined)}
      >
        {previewAttachment?.previewUrl ? (
          <div className="rm-source-viewer">
            {previewUrlForAttachment(previewAttachment) ? (
              <iframe
                sandbox=""
                src={previewUrlForAttachment(previewAttachment)}
                title={`${t("previewOf")} ${previewAttachment.fileName}`}
              />
            ) : (
              <p className="text-sm text-muted">{t("unsafePreview")}</p>
            )}
            <a
              href={previewAttachment.previewUrl}
              rel="noreferrer"
              target="_blank"
            >
              {t("openOriginal")}
            </a>
          </div>
        ) : (
          <p>{t("previewUnavailable")}</p>
        )}
      </FormDialog>
    </>
  );
});

function previewUrlForAttachment(
  attachment: MessageAttachment,
): string | undefined {
  if (attachment.previewUrl === undefined) return undefined;
  if (isOfficeMimeType(attachment.mimeType))
    return `${attachment.previewUrl}/preview`;
  return canInlinePreview(attachment.mimeType)
    ? attachment.previewUrl
    : undefined;
}

function canInlinePreview(mimeType: string): boolean {
  return (
    mimeType.startsWith("image/") ||
    mimeType === "application/pdf" ||
    mimeType.startsWith("text/") ||
    mimeType === "application/json"
  );
}

function isOfficeMimeType(mimeType: string): boolean {
  return (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    mimeType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
}

function MessageAttachments({
  message,
  onRetentionChange,
  onPreview,
}: {
  message: Message;
  onRetentionChange: (
    messageId: string,
    attachmentId: string,
    retainedInContext: boolean,
  ) => void;
  onPreview: (attachment: MessageAttachment) => void;
}) {
  const { t } = useLocale();
  if (!message.attachments?.length) return null;
  return (
    <div className="rm-message-attachments">
      {message.attachments.map((attachment) => (
        <div className="rm-attachment-with-retention" key={attachment.id}>
          <Button
            className="rm-attachment-tile"
            disabled={attachment.previewUrl === undefined}
            onClick={() => onPreview(attachment)}
            type="button"
          >
            {attachment.previewUrl && attachment.kind === "image" ? (
              <img
                alt={attachment.fileName}
                height={48}
                loading="lazy"
                src={attachment.previewUrl}
                width={48}
              />
            ) : null}
            <div className="truncate">{attachment.fileName}</div>
          </Button>
          <label title={t("keepContextTitle")}>
            <Input
              checked={attachment.retainedInContext}
              onChange={(event) =>
                onRetentionChange(
                  message.id,
                  attachment.id,
                  event.currentTarget.checked,
                )
              }
              type="checkbox"
            />
            {t("keepContext")}
          </label>
        </div>
      ))}
    </div>
  );
}

function MessageActions({ children }: { children: React.ReactNode }) {
  return <div className="rm-message-actions">{children}</div>;
}

function Action({
  active = false,
  children,
  disabled = false,
  label,
  onClick,
}: {
  active?: boolean;
  children: React.ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      aria-label={label}
      className={`rm-message-tool ${active ? "active" : ""}`}
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </Button>
  );
}

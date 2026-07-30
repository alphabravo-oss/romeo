import { Textarea, Button } from "@romeo/ui";
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
import { writeTextToClipboard } from "../lib/clipboard";
import { Markdown } from "../lib/markdown";
import { useLocale } from "../lib/i18n";
import { formatDateTime } from "../lib/locale-format";
import { toast } from "../lib/toast";
import type { ChatCitation, ChatRunActivity } from "./useWorkspaceController";
import {
  CitationList,
  formatSpeechArtifact,
  RunActivityList,
} from "./ChatMessageMetadata";
import { FormDialog } from "./FormDialog";
import {
  Action,
  MessageActions,
  MessageAttachments,
  previewUrlForAttachment,
} from "./ChatMessageActions";

export const ChatMessages = memo(function ChatMessages({
  activeVoiceProfileId,
  agentName,
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
  agentName: string;
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
  onEditAndResend: (messageId: string, content: string) => Promise<boolean>;
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

  async function copy(message: Message) {
    if (!(await writeTextToClipboard(message.content))) {
      toast(t("copyFailed"), "error");
      return;
    }
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
              isStreaming={isStreaming}
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
                          disabled={
                            isStreaming || editValue.trim().length === 0
                          }
                          onClick={() => {
                            void (async () => {
                              const ok = await onEditAndResend(
                                message.id,
                                editValue,
                              );
                              if (ok) setEditingId(undefined);
                            })();
                          }}
                          title={
                            isStreaming ? t("waitForResponse") : t("saveSubmit")
                          }
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
                        onClick={() => void copy(message)}
                      >
                        {copiedId === message.id ? (
                          <Check size={15} />
                        ) : (
                          <Copy size={15} />
                        )}
                      </Action>
                      <Action
                        disabled={isStreaming}
                        label={t("editResend")}
                        onClick={() => {
                          setEditingId(message.id);
                          setEditValue(message.content);
                        }}
                        title={
                          isStreaming ? t("waitForResponse") : t("editResend")
                        }
                      >
                        <Pencil size={15} />
                      </Action>
                      <Action
                        disabled={isStreaming}
                        label={t("branch")}
                        onClick={() => onBranch(message.id)}
                        title={isStreaming ? t("waitForResponse") : t("branch")}
                      >
                        <GitBranch size={15} />
                      </Action>
                      <Action
                        disabled={isStreaming}
                        label={t("deleteMessage")}
                        onClick={() => onDelete(message.id)}
                        title={
                          isStreaming
                            ? t("waitForResponse")
                            : t("deleteMessage")
                        }
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
                  <span>{agentName}</span>
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
                      // The assistant message immediately above is the text
                      // alternative for this generated speech-only artifact.
                      // oxlint-disable-next-line jsx-a11y/media-has-caption
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
                        pressed={messageFeedback?.rating === "positive"}
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
                        pressed={messageFeedback?.rating === "negative"}
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
                        disabled={isStreaming}
                        label={t("branch")}
                        onClick={() => onBranch(message.id)}
                        title={isStreaming ? t("waitForResponse") : t("branch")}
                      >
                        <GitBranch size={15} />
                      </Action>
                      <Action
                        disabled={isStreaming}
                        label={t("deleteMessage")}
                        onClick={() => onDelete(message.id)}
                        title={
                          isStreaming
                            ? t("waitForResponse")
                            : t("deleteMessage")
                        }
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

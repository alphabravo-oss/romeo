import { Textarea, Button } from "@romeo/ui";
import BotMessageSquare from "lucide-react/dist/esm/icons/bot-message-square.mjs";
import Check from "lucide-react/dist/esm/icons/check.mjs";
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left.mjs";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right.mjs";
import Copy from "lucide-react/dist/esm/icons/copy.mjs";
import GitBranch from "lucide-react/dist/esm/icons/git-branch.mjs";
import Pencil from "lucide-react/dist/esm/icons/pencil.mjs";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.mjs";
import ThumbsDown from "lucide-react/dist/esm/icons/thumbs-down.mjs";
import ThumbsUp from "lucide-react/dist/esm/icons/thumbs-up.mjs";
import Trash2 from "lucide-react/dist/esm/icons/trash-2.mjs";
import User from "lucide-react/dist/esm/icons/user.mjs";
import Volume2 from "lucide-react/dist/esm/icons/volume-2.mjs";
import { memo } from "react";

import type {
  Message,
  MessageAttachment,
  SpeechArtifact,
} from "../features/types";
import { Markdown } from "../lib/markdown";
import { useLocale } from "../lib/i18n";
import { formatDateTime } from "../lib/locale-format";
import type {
  ChatCitation,
  ChatReasoning,
  ChatRunActivity,
} from "../lib/run-registry";
import type { ChatToolCall } from "../lib/run-tool-calls";
import {
  CitationList,
  formatSpeechArtifact,
  ReasoningPanel,
  RunActivityList,
  ToolCallList,
} from "./ChatMessageMetadata";
import {
  Action,
  MessageActions,
  MessageAttachments,
} from "./ChatMessageActions";

/**
 * One transcript row, memoised. A streamed answer changes the message array
 * once per token, so without this every row in the conversation reconciles on
 * every token. Every prop is therefore either a scalar or an identity that only
 * changes when that row's own content does -- notably per-message slices of the
 * feedback and speech records rather than the whole records, and frozen empties
 * for the run state that belongs to the last row alone.
 */
export const ChatMessageRow = memo(function ChatMessageRow({
  activeVoiceProfileId,
  agentName,
  artifact,
  citations,
  copied,
  editing,
  editValue,
  isGeneratingSpeech,
  isLast,
  isSpeechTarget,
  isStreaming,
  isThinking,
  message,
  nextVariantId,
  onAttachmentRetention,
  onBranch,
  onCancelEdit,
  onContinue,
  onCopy,
  onDelete,
  onEditValueChange,
  onGenerateSpeech,
  onPreview,
  onRate,
  onRegenerate,
  onSelectVariant,
  onStartEdit,
  onSubmitEdit,
  previousVariantId,
  rating,
  reasoning,
  runActivities,
  toolCalls,
  variantIndex,
  variantTotal,
}: {
  activeVoiceProfileId: string | undefined;
  agentName: string;
  artifact: SpeechArtifact | undefined;
  citations: ChatCitation[];
  copied: boolean;
  editing: boolean;
  editValue: string;
  isGeneratingSpeech: boolean;
  isLast: boolean;
  isSpeechTarget: boolean;
  isStreaming: boolean;
  isThinking: boolean;
  message: Message;
  nextVariantId: string | undefined;
  onAttachmentRetention: (
    messageId: string,
    attachmentId: string,
    retainedInContext: boolean,
  ) => void;
  onBranch: (messageId: string) => void;
  onCancelEdit: () => void;
  onContinue: () => void;
  onCopy: (message: Message) => void;
  onDelete: (messageId: string) => void;
  onEditValueChange: (value: string) => void;
  onGenerateSpeech: (messageId: string) => void;
  onPreview: (attachment: MessageAttachment) => void;
  onRate: (messageId: string, rating: "negative" | "none" | "positive") => void;
  onRegenerate: () => void;
  onSelectVariant: (messageId: string) => void;
  onStartEdit: (message: Message) => void;
  onSubmitEdit: (messageId: string, content: string) => void;
  previousVariantId: string | undefined;
  rating: "negative" | "positive" | undefined;
  reasoning: ChatReasoning | undefined;
  runActivities: ChatRunActivity[];
  toolCalls: ChatToolCall[];
  /** Sibling position, spread into scalars so the memo survives a stream. */
  variantIndex: number | undefined;
  variantTotal: number | undefined;
}) {
  const { locale, t } = useLocale();
  const attachments = (
    <MessageAttachments
      isStreaming={isStreaming}
      message={message}
      onRetentionChange={onAttachmentRetention}
      onPreview={onPreview}
    />
  );
  const variantSwitcher =
    variantIndex === undefined || variantTotal === undefined ? null : (
      <VariantSwitcher
        disabled={isStreaming}
        index={variantIndex}
        nextId={nextVariantId}
        onSelect={onSelectVariant}
        previousId={previousVariantId}
        total={variantTotal}
      />
    );

  if (message.role !== "assistant") {
    return (
      <article className="rm-message-row user">
        <div className="rm-message-body">
          {editing ? (
            <div className="rm-message-edit">
              <Textarea
                aria-label={t("editResend")}
                autoFocus
                onChange={(event) =>
                  onEditValueChange(event.currentTarget.value)
                }
                rows={Math.min(12, Math.max(3, editValue.split("\n").length))}
                value={editValue}
              />
              <div className="rm-message-edit-actions">
                <Button onClick={onCancelEdit} type="button">
                  {t("cancel")}
                </Button>
                <Button
                  className="primary"
                  disabled={isStreaming || editValue.trim().length === 0}
                  onClick={() => onSubmitEdit(message.id, editValue)}
                  title={isStreaming ? t("waitForResponse") : t("saveSubmit")}
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
            <>
              {variantSwitcher}
              <MessageActions>
                <Action
                  label={copied ? t("copied") : t("copy")}
                  onClick={() => onCopy(message)}
                >
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                </Action>
                <Action
                  disabled={isStreaming}
                  label={t("editResend")}
                  onClick={() => onStartEdit(message)}
                  title={isStreaming ? t("waitForResponse") : t("editResend")}
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
                    isStreaming ? t("waitForResponse") : t("deleteMessage")
                  }
                >
                  <Trash2 size={15} />
                </Action>
              </MessageActions>
            </>
          )}
        </div>
        <div className="rm-message-avatar user">
          <User aria-hidden="true" size={16} />
        </div>
      </article>
    );
  }

  return (
    <article className="rm-message-row assistant">
      <div className="rm-message-avatar">
        <BotMessageSquare aria-hidden="true" size={16} />
      </div>
      <div className="rm-message-body">
        <div className="rm-message-heading">
          <span>{agentName}</span>
        </div>
        {reasoning === undefined ? null : (
          <ReasoningPanel reasoning={reasoning} streaming={isThinking} />
        )}
        <ToolCallList calls={toolCalls} />
        <div className="rm-message-content">
          {isThinking ? (
            <span className="rm-skeleton" />
          ) : (
            <Markdown
              citations={message.citations ?? citations}
              content={message.content}
              messageId={message.id}
              streaming={isLast && isStreaming}
            />
          )}
        </div>
        {isLast && isStreaming ? (
          <RunActivityList activities={runActivities} />
        ) : null}
        {(message.citations?.length ?? citations.length) > 0 ? (
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
              <audio controls preload="metadata" src={artifact.playbackUrl} />
            ) : null}
          </div>
        ) : null}
        {isThinking ? null : (
          <>
            {variantSwitcher}
            <MessageActions>
              <Action
                label={copied ? t("copied") : t("copy")}
                onClick={() => onCopy(message)}
              >
                {copied ? <Check size={15} /> : <Copy size={15} />}
              </Action>
              <Action
                active={rating === "positive"}
                label={t("goodResponse")}
                onClick={() =>
                  onRate(
                    message.id,
                    rating === "positive" ? "none" : "positive",
                  )
                }
                pressed={rating === "positive"}
              >
                <ThumbsUp size={15} />
              </Action>
              <Action
                active={rating === "negative"}
                label={t("poorResponse")}
                onClick={() =>
                  onRate(
                    message.id,
                    rating === "negative" ? "none" : "negative",
                  )
                }
                pressed={rating === "negative"}
              >
                <ThumbsDown size={15} />
              </Action>
              <Action
                disabled={
                  isStreaming ||
                  activeVoiceProfileId === undefined ||
                  (isGeneratingSpeech && isSpeechTarget)
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
                title={isStreaming ? t("waitForResponse") : t("deleteMessage")}
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
});

/**
 * "‹ 2 / 3 ›" over the siblings of a regenerated or edited turn. Selecting one
 * repoints the chat at that branch, which is how the answer this one replaced
 * stays reachable.
 */
function VariantSwitcher({
  disabled,
  index,
  nextId,
  onSelect,
  previousId,
  total,
}: {
  disabled: boolean;
  index: number;
  nextId: string | undefined;
  onSelect: (messageId: string) => void;
  previousId: string | undefined;
  total: number;
}) {
  const { t } = useLocale();
  return (
    <div className="rm-message-variants">
      <Action
        disabled={disabled || previousId === undefined}
        label={t("previousVariant")}
        onClick={() => previousId !== undefined && onSelect(previousId)}
      >
        <ChevronLeft size={14} />
      </Action>
      <span className="rm-message-variant-count">
        {index + 1} / {total}
      </span>
      <Action
        disabled={disabled || nextId === undefined}
        label={t("nextVariant")}
        onClick={() => nextId !== undefined && onSelect(nextId)}
      >
        <ChevronRight size={14} />
      </Action>
    </div>
  );
}

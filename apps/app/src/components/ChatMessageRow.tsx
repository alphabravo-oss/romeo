import { Textarea, Button, DropdownMenu } from "@romeo/ui";
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
import { memo, type ReactNode } from "react";

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
  ChatRunWait,
} from "../lib/run-registry";
import type { ChatToolCall } from "../lib/run-tool-calls";
import {
  CitationList,
  formatSpeechArtifact,
  ReasoningPanel,
  RunStatusStack,
  ToolCallList,
} from "./ChatMessageMetadata";
import {
  Action,
  MessageActions,
  MessageAttachments,
} from "./ChatMessageActions";
import {
  buildProvenanceChips,
  canPerformChatWriteAction,
  isGenericCustomModelName,
  policyErrorCopy,
  type ChatWriteAction,
} from "./chat-enterprise";
import { ChatFollowUps } from "./ChatFollowUps";

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
  authorName,
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
  modelDisplayName,
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
  onRegenerateWith,
  onFollowUp,
  regenerateModels,
  onSelectVariant,
  onStartEdit,
  onSubmitEdit,
  previousVariantId,
  rating,
  reasoning,
  runActivities,
  runWait,
  showContinueButton,
  showFollowUps,
  showMessageTimestamps,
  showRunStatus,
  chatAccess,
  agentName,
  toolCalls,
  variantIndex,
  variantTotal,
}: {
  activeVoiceProfileId: string | undefined;
  authorName: string | undefined;
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
  /** Display name of the model that produced this assistant turn. */
  modelDisplayName: string | undefined;
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
  onRate: (
    messageId: string,
    rating: "negative" | "none" | "positive",
    reasonCode?: string,
  ) => void;
  onRegenerate: () => void;
  onRegenerateWith: (input: {
    modelId?: string;
    mode?: "again" | "shorter";
  }) => void;
  onFollowUp: (prompt: string) => void;
  regenerateModels: Array<{ id: string; label: string }>;
  onSelectVariant: (messageId: string) => void;
  onStartEdit: (message: Message) => void;
  onSubmitEdit: (messageId: string, content: string) => void;
  previousVariantId: string | undefined;
  rating: "negative" | "positive" | undefined;
  reasoning: ChatReasoning | undefined;
  runActivities: ChatRunActivity[];
  runWait: ChatRunWait | undefined;
  showContinueButton: boolean;
  showFollowUps: boolean;
  showMessageTimestamps: boolean;
  showRunStatus: boolean;
  chatAccess: "owner" | "write" | "read";
  agentName: string | undefined;
  toolCalls: ChatToolCall[];
  /** Sibling position, spread into scalars so the memo survives a stream. */
  variantIndex: number | undefined;
  variantTotal: number | undefined;
}) {
  const { locale, t } = useLocale();
  const canWrite = (action: ChatWriteAction) =>
    canPerformChatWriteAction(chatAccess, action);
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
            <MessageToolbar
              {...(showMessageTimestamps
                ? { timestamp: formatDateTime(message.createdAt, locale) }
                : {})}
            >
              {variantSwitcher}
              <MessageActions>
                <Action
                  label={copied ? t("copied") : t("copy")}
                  onClick={() => onCopy(message)}
                >
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                </Action>
                {canWrite("edit") ? (
                  <Action
                    disabled={isStreaming}
                    label={t("editResend")}
                    onClick={() => onStartEdit(message)}
                    title={isStreaming ? t("waitForResponse") : t("editResend")}
                  >
                    <Pencil size={15} />
                  </Action>
                ) : null}
                {canWrite("branch") ? (
                  <Action
                    disabled={isStreaming}
                    label={t("branch")}
                    onClick={() => onBranch(message.id)}
                    title={isStreaming ? t("waitForResponse") : t("branch")}
                  >
                    <GitBranch size={15} />
                  </Action>
                ) : null}
                {canWrite("delete") ? (
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
                ) : null}
              </MessageActions>
            </MessageToolbar>
          )}
        </div>
        <div className="rm-message-avatar user">
          <User aria-hidden="true" size={16} />
        </div>
      </article>
    );
  }

  const runError = message.error;
  const showThinking = isThinking && runError === undefined;
  const policyError =
    runError === undefined
      ? undefined
      : policyErrorCopy({
          code: runError.code,
          ...(runError.message === undefined
            ? {}
            : { message: runError.message }),
        });
  const headingName =
    authorName !== undefined && !isGenericCustomModelName(authorName)
      ? authorName
      : modelDisplayName;
  const provenance = buildProvenanceChips({
    ...(message.modelId === undefined ? {} : { modelId: message.modelId }),
    ...(modelDisplayName === undefined ? {} : { modelDisplayName }),
    // Custom model name is the model identity, not a persona chip.
    ...(agentName === undefined ||
    agentName === modelDisplayName ||
    isGenericCustomModelName(agentName)
      ? {}
      : { agentName }),
    toolCallCount: isLast ? toolCalls.length : 0,
    citationCount: (message.citations ?? citations).length,
  });

  return (
    <article
      className={`rm-message-row assistant${runError === undefined ? "" : " error"}`}
    >
      <div className="rm-message-avatar">
        <BotMessageSquare aria-hidden="true" size={16} />
      </div>
      <div className="rm-message-body">
        {headingName === undefined ? null : (
          <div className="rm-message-heading">
            <span className="rm-message-model-primary" title={message.modelId}>
              {headingName}
            </span>
          </div>
        )}
        {(() => {
          const chips =
            headingName === undefined
              ? provenance
              : provenance.filter((chip) => chip.kind !== "model");
          if (chips.length === 0 || showThinking) return null;
          return (
            <div className="rm-message-provenance" aria-label={t("provenance")}>
              {chips.map((chip) => (
                <span
                  className={`rm-message-provenance__chip rm-message-provenance__chip--${chip.kind}`}
                  key={`${chip.kind}-${chip.label}`}
                >
                  {chip.label}
                </span>
              ))}
            </div>
          );
        })()}
        {reasoning === undefined ? null : (
          <ReasoningPanel reasoning={reasoning} streaming={showThinking} />
        )}
        <ToolCallList calls={toolCalls} />
        {isLast && isStreaming && showRunStatus ? (
          <RunStatusStack
            activities={runActivities}
            wait={runWait}
            waitLabel={showThinking ? waitStatusLabel(runWait, t) : undefined}
          />
        ) : null}
        {runError === undefined || policyError === undefined ? (
          <div className="rm-message-content">
            {showThinking ? (
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
        ) : (
          <div className="rm-message-run-error" role="alert">
            <div className="rm-message-run-error__title">
              {policyError.title}
            </div>
            <p className="rm-message-run-error__body">{policyError.body}</p>
            <p className="rm-message-run-error__next">{policyError.nextStep}</p>
            <code className="rm-message-run-error__code">
              {policyError.code}
            </code>
            {!isStreaming && isLast && canWrite("regenerate") ? (
              <div className="rm-message-run-error__actions">
                <Button onClick={onRegenerate} type="button" variant="primary">
                  <RefreshCw aria-hidden="true" size={14} />
                  {t("regenerate")}
                </Button>
              </div>
            ) : null}
          </div>
        )}
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
        {showThinking || runError !== undefined ? null : (
          <>
            <MessageToolbar
              {...(showMessageTimestamps
                ? { timestamp: formatDateTime(message.createdAt, locale) }
                : {})}
            >
              {variantSwitcher}
              <MessageActions>
                <Action
                  label={copied ? t("copied") : t("copy")}
                  onClick={() => onCopy(message)}
                >
                  {copied ? <Check size={15} /> : <Copy size={15} />}
                </Action>
                {canWrite("rate") ? (
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
                ) : null}
                {canWrite("rate") ? (
                  <DropdownMenu
                    align="start"
                    items={
                      rating === "negative"
                        ? [
                            {
                              label: t("clearFeedback"),
                              onSelect: () => onRate(message.id, "none"),
                            },
                          ]
                        : [
                            {
                              label: t("feedbackInaccurate"),
                              onSelect: () =>
                                onRate(message.id, "negative", "inaccurate"),
                            },
                            {
                              label: t("feedbackUnhelpful"),
                              onSelect: () =>
                                onRate(message.id, "negative", "unhelpful"),
                            },
                            {
                              label: t("feedbackUnsafe"),
                              onSelect: () =>
                                onRate(message.id, "negative", "unsafe"),
                            },
                            {
                              label: t("feedbackOffTopic"),
                              onSelect: () =>
                                onRate(message.id, "negative", "off_topic"),
                            },
                            {
                              label: t("feedbackTooLong"),
                              onSelect: () =>
                                onRate(message.id, "negative", "too_long"),
                            },
                            {
                              label: t("feedbackOther"),
                              onSelect: () =>
                                onRate(message.id, "negative", "other"),
                            },
                          ]
                    }
                    trigger={
                      <Button
                        aria-label={t("poorResponse")}
                        aria-pressed={rating === "negative" || undefined}
                        className={`rm-message-tool${rating === "negative" ? " active" : ""}`}
                        title={t("poorResponse")}
                        type="button"
                      >
                        <ThumbsDown size={15} />
                      </Button>
                    }
                  />
                ) : null}
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
                {canWrite("branch") ? (
                  <Action
                    disabled={isStreaming}
                    label={t("branch")}
                    onClick={() => onBranch(message.id)}
                    title={isStreaming ? t("waitForResponse") : t("branch")}
                  >
                    <GitBranch size={15} />
                  </Action>
                ) : null}
                {canWrite("delete") ? (
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
                ) : null}
                {!isStreaming && isLast && canWrite("regenerate") ? (
                  <DropdownMenu
                    align="start"
                    items={[
                      {
                        label: t("regenerateAgain"),
                        onSelect: () => onRegenerateWith({ mode: "again" }),
                      },
                      {
                        label: t("regenerateShorter"),
                        onSelect: () => onRegenerateWith({ mode: "shorter" }),
                      },
                      ...regenerateModels.slice(0, 6).map((model, index) => ({
                        label: t("regenerateWithModel", { model: model.label }),
                        onSelect: () =>
                          onRegenerateWith({
                            mode: "again",
                            modelId: model.id,
                          }),
                        ...(index === 0 ? { separatorBefore: true } : {}),
                      })),
                    ]}
                    trigger={
                      <Button
                        aria-label={t("regenerate")}
                        className="rm-message-tool"
                        title={t("regenerate")}
                        type="button"
                      >
                        <RefreshCw size={15} />
                      </Button>
                    }
                  />
                ) : null}
              </MessageActions>
            </MessageToolbar>
            {!isStreaming && isLast && (showContinueButton || showFollowUps) ? (
              <div className="rm-message-after">
                {showContinueButton ? (
                  <Button
                    className="rm-continue-button"
                    onClick={onContinue}
                    type="button"
                  >
                    {t("continue")}
                  </Button>
                ) : null}
                {showFollowUps ? (
                  <ChatFollowUps
                    assistantContent={message.content}
                    disabled={isStreaming}
                    onSelect={onFollowUp}
                  />
                ) : null}
              </div>
            ) : null}
          </>
        )}
        {runError !== undefined && showMessageTimestamps ? (
          <MessageToolbar
            timestamp={formatDateTime(message.createdAt, locale)}
          />
        ) : null}
      </div>
    </article>
  );
});

function waitStatusLabel(
  wait: ChatRunWait | undefined,
  t: (
    key: import("../lib/i18n").MessageKey,
    values?: Record<string, boolean | number | string>,
  ) => string,
): string {
  if (wait === undefined) return t("chatActivityGeneratingResponse");
  if (wait.phase === "reconnecting") {
    return t("streamReconnecting");
  }
  const timeoutSeconds =
    wait.streamTimeoutMs === undefined
      ? undefined
      : Math.max(1, Math.round(wait.streamTimeoutMs / 1_000));
  if (wait.phase === "streaming") return t("chatActivityGeneratingResponse");
  if (wait.phase === "retrying") {
    return timeoutSeconds === undefined
      ? t("modelWaitRetrying", {
          attempt: wait.attempt,
          maxAttempts: wait.maxAttempts,
          seconds: wait.elapsedSeconds,
        })
      : t("modelWaitRetryingBudget", {
          attempt: wait.attempt,
          maxAttempts: wait.maxAttempts,
          seconds: wait.elapsedSeconds,
          timeout: timeoutSeconds,
        });
  }
  return timeoutSeconds === undefined
    ? t("modelWaitElapsed", { seconds: wait.elapsedSeconds })
    : t("modelWaitElapsedBudget", {
        seconds: wait.elapsedSeconds,
        timeout: timeoutSeconds,
      });
}

/**
 * "‹ 2 / 3 ›" over the siblings of a regenerated or edited turn. Selecting one
 * repoints the chat at that branch, which is how the answer this one replaced
 * stays reachable.
 */
function MessageToolbar({
  children,
  timestamp,
}: {
  children?: ReactNode;
  timestamp?: string;
}) {
  return (
    <div className="rm-message-toolbar">
      <div className="rm-message-toolbar__controls">{children}</div>
      {timestamp === undefined ? null : (
        <span className="rm-message-meta" suppressHydrationWarning>
          {timestamp}
        </span>
      )}
    </div>
  );
}

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

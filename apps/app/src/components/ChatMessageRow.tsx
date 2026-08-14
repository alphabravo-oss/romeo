import { Button, DropdownMenu } from "@romeo/ui";
import BotMessageSquare from "lucide-react/dist/esm/icons/bot-message-square.mjs";
import Check from "lucide-react/dist/esm/icons/check.mjs";
import Copy from "lucide-react/dist/esm/icons/copy.mjs";
import GitBranch from "lucide-react/dist/esm/icons/git-branch.mjs";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw.mjs";
import ThumbsDown from "lucide-react/dist/esm/icons/thumbs-down.mjs";
import ThumbsUp from "lucide-react/dist/esm/icons/thumbs-up.mjs";
import Trash2 from "lucide-react/dist/esm/icons/trash-2.mjs";
import Volume2 from "lucide-react/dist/esm/icons/volume-2.mjs";
import { memo } from "react";

import { Markdown } from "../lib/markdown";
import { useLocale } from "../lib/i18n";
import { formatDateTime } from "../lib/locale-format";
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
import { UserChatMessageRow } from "./UserChatMessageRow";
import type { ChatMessageRowProps } from "./chat-message-row-types";
import { StreamingAssistantMessage } from "./StreamingAssistantMessage";
import { transcriptMessageDomId } from "./TranscriptWindow";
import { VisibilityAwareAudio } from "./VisibilityAwareAudio";
import { MessageHeading, messageHeadingId } from "./MessageHeading";
import {
  MessageToolbar,
  VariantSwitcher,
  waitStatusLabel,
} from "./ChatMessageRowControls";

export const ChatMessageRow = memo(function ChatMessageRow(
  props: ChatMessageRowProps,
) {
  return props.observeStreamingMessage ? (
    <StreamingAssistantMessage
      fallback={props.message}
      onContentChange={props.onStreamingContentChange}
    >
      {(message) => (
        <ChatMessageRowView
          {...props}
          isThinking={
            message.role === "assistant" &&
            message.error === undefined &&
            message.content.length === 0 &&
            props.isStreaming
          }
          message={message}
        />
      )}
    </StreamingAssistantMessage>
  ) : (
    <ChatMessageRowView {...props} />
  );
});

const ChatMessageRowView = memo(function ChatMessageRowView({
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
  positionInSet,
  setSize,
  modelDisplayName,
  nextVariantId,
  onAttachmentRetention,
  onBranch,
  onCancelEdit,
  onContinue,
  onCreateFeedbackEvalCase,
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
}: ChatMessageRowProps) {
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
      <UserChatMessageRow
        attachments={attachments}
        canBranch={canWrite("branch")}
        canDelete={canWrite("delete")}
        canEdit={canWrite("edit")}
        copied={copied}
        editing={editing}
        editValue={editValue}
        isStreaming={isStreaming}
        message={message}
        positionInSet={positionInSet}
        setSize={setSize}
        onBranch={onBranch}
        onCancelEdit={onCancelEdit}
        onCopy={onCopy}
        onDelete={onDelete}
        onEditValueChange={onEditValueChange}
        onStartEdit={onStartEdit}
        onSubmitEdit={onSubmitEdit}
        showMessageTimestamps={showMessageTimestamps}
        variantSwitcher={variantSwitcher}
      />
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
      aria-labelledby={messageHeadingId(message.id)}
      aria-posinset={positionInSet}
      aria-setsize={setSize}
      className={`rm-message-row assistant${runError === undefined ? "" : " error"}`}
      data-message-id={message.id}
      id={transcriptMessageDomId(message.id)}
      tabIndex={-1}
    >
      <MessageHeading id={message.id} position={positionInSet} />
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
          <ReasoningPanel
            reasoning={reasoning}
            streaming={showThinking && !reasoning.completed}
          />
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
              <VisibilityAwareAudio src={artifact.playbackUrl} />
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
                            ...(onCreateFeedbackEvalCase === undefined
                              ? []
                              : [
                                  {
                                    label: t("feedbackAddToEvals"),
                                    onSelect: () =>
                                      onCreateFeedbackEvalCase(message.id),
                                  },
                                ]),
                            {
                              label: t("clearFeedback"),
                              separatorBefore:
                                onCreateFeedbackEvalCase !== undefined,
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

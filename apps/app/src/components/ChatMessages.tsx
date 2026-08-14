import { memo, useCallback, useState } from "react";

import type {
  Message,
  MessageAttachment,
  MessageFeedbackState,
  SpeechArtifact,
} from "../features/types";
import { writeTextToClipboard } from "../lib/clipboard";
import { useLocale } from "../lib/i18n";
import { toast } from "../lib/toast";
import type { ChatToolCall } from "../lib/run-tool-calls";
import type { ChatRunWait } from "../lib/run-registry";
import type {
  ChatCitation,
  ChatReasoning,
  ChatRunActivity,
} from "./workspace-controller-types";
import { FormDialog } from "./FormDialog";
import { previewUrlForAttachment } from "./ChatMessageActions";
import { ChatMessageRow } from "./ChatMessageRow";
import type { MessageBranchVariants } from "../lib/message-page-query";
import { TranscriptWindow } from "./TranscriptWindow";

// Frozen empties handed to every row but the last. Run state (activities,
// citations, tool calls) belongs to the streaming answer alone, and a fresh []
// per row would defeat ChatMessageRow's memo on every token.
const noActivities: ChatRunActivity[] = [];
const noCitations: ChatCitation[] = [];
const noToolCalls: ChatToolCall[] = [];

/** Prefer the model on the message; while streaming, fall back to the picker. */
export function resolveMessageModelLabel(input: {
  messageModelId: string | undefined;
  modelDisplayNames: Record<string, string>;
  selectedModelId: string | undefined;
}): string | undefined {
  const id = input.messageModelId ?? input.selectedModelId;
  if (id === undefined || id.trim().length === 0) return undefined;
  return input.modelDisplayNames[id] ?? id;
}

function estimateTranscriptMessageHeight(message: Message): number {
  const textLines = Math.max(1, Math.ceil(message.content.length / 88));
  const attachmentHeight = (message.attachments?.length ?? 0) * 56;
  const roleBase = message.role === "assistant" ? 136 : 104;
  return Math.min(760, roleBase + textLines * 24 + attachmentHeight);
}

export const ChatMessages = memo(function ChatMessages({
  activeVoiceProfileId,
  authorName,
  citations,
  feedback,
  isGeneratingSpeech,
  isStreaming,
  messages,
  modelDisplayNames,
  selectedModelId,
  onBranch,
  onAttachmentRetention,
  onContinue,
  onCreateFeedbackEvalCase,
  onDelete,
  onEditAndResend,
  onGenerateSpeech,
  onRate,
  onRegenerate,
  onRegenerateWith,
  onFollowUp,
  regenerateModels,
  onSelectVariant,
  onStreamingContentChange,
  getScrollElement,
  reasoning,
  runActivities,
  runWait,
  showContinueButton,
  showFollowUps,
  showMessageModelLabel,
  showMessageTimestamps,
  showRunStatus,
  chatAccess,
  agentName,
  speechArtifacts,
  speechMessageId,
  streamingAssistantMessageId,
  toolCalls,
  variantsByMessageId,
}: {
  activeVoiceProfileId: string | undefined;
  authorName: string | undefined;
  citations: ChatCitation[];
  feedback: Record<string, MessageFeedbackState>;
  isGeneratingSpeech: boolean;
  isStreaming: boolean;
  messages: Message[];
  modelDisplayNames: Record<string, string>;
  /** Composer selection — used only while streaming before modelId is persisted. */
  selectedModelId: string | undefined;
  onBranch: (messageId: string) => void;
  onAttachmentRetention: (
    messageId: string,
    attachmentId: string,
    retainedInContext: boolean,
  ) => void;
  onContinue: () => void;
  onCreateFeedbackEvalCase?: (messageId: string) => void;
  onDelete: (messageId: string) => void;
  onEditAndResend: (messageId: string, content: string) => Promise<boolean>;
  onGenerateSpeech: (messageId: string) => void;
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
  onStreamingContentChange: () => void;
  getScrollElement: () => HTMLDivElement | null;
  reasoning: ChatReasoning | undefined;
  runActivities: ChatRunActivity[];
  runWait: ChatRunWait | undefined;
  showContinueButton: boolean;
  showFollowUps: boolean;
  showMessageModelLabel: boolean;
  showMessageTimestamps: boolean;
  showRunStatus: boolean;
  chatAccess: "owner" | "write" | "read";
  agentName: string | undefined;
  speechArtifacts: Record<string, SpeechArtifact>;
  speechMessageId: string | undefined;
  streamingAssistantMessageId: string | undefined;
  toolCalls: ChatToolCall[];
  variantsByMessageId: Record<string, MessageBranchVariants>;
}) {
  const { t } = useLocale();
  const [editingId, setEditingId] = useState<string>();
  const [editValue, setEditValue] = useState("");
  const [copiedId, setCopiedId] = useState<string>();
  const [previewAttachment, setPreviewAttachment] =
    useState<MessageAttachment>();
  // Stable identities, or the per-row memo never holds: a new closure per
  // render is a changed prop on every row.
  const handleCopy = useCallback(
    (message: Message) => {
      void (async () => {
        if (!(await writeTextToClipboard(message.content))) {
          toast(t("copyFailed"), "error");
          return;
        }
        setCopiedId(message.id);
        window.setTimeout(() => setCopiedId(undefined), 1_500);
      })();
    },
    [t],
  );
  const handleStartEdit = useCallback((message: Message) => {
    setEditingId(message.id);
    setEditValue(message.content);
  }, []);
  const handleCancelEdit = useCallback(() => setEditingId(undefined), []);
  // Takes the draft as an argument rather than closing over it: a dependency on
  // editValue would change this identity on every keystroke, which is a changed
  // prop on every row in the transcript.
  const handleSubmitEdit = useCallback(
    (messageId: string, content: string) => {
      void (async () => {
        if (await onEditAndResend(messageId, content)) {
          setEditingId(undefined);
        }
      })();
    },
    [onEditAndResend],
  );
  const estimateSize = useCallback(
    (index: number) => {
      const message = messages[index];
      return message === undefined
        ? 180
        : estimateTranscriptMessageHeight(message);
    },
    [messages],
  );
  const renderMessage = useCallback(
    (message: Message, index: number) => {
      const isLast = index === messages.length - 1;
      const isThinking =
        message.role === "assistant" &&
        message.error === undefined &&
        message.content.length === 0 &&
        isStreaming;
      // Flattened to scalars so stable rows keep their memo boundary when
      // branch topology changes at a message boundary.
      const variants = variantsByMessageId[message.id];
      return (
        <ChatMessageRow
          activeVoiceProfileId={activeVoiceProfileId}
          authorName={authorName}
          artifact={speechArtifacts[message.id]}
          citations={isLast ? citations : noCitations}
          copied={copiedId === message.id}
          editing={editingId === message.id}
          editValue={editingId === message.id ? editValue : ""}
          isGeneratingSpeech={isGeneratingSpeech}
          isLast={isLast}
          isSpeechTarget={speechMessageId === message.id}
          isStreaming={isStreaming}
          isThinking={isThinking}
          key={message.id}
          message={message}
          modelDisplayName={
            !showMessageModelLabel
              ? undefined
              : resolveMessageModelLabel({
                  messageModelId: message.modelId,
                  modelDisplayNames,
                  selectedModelId:
                    isLast && isStreaming ? selectedModelId : undefined,
                })
          }
          nextVariantId={variants?.nextLeafMessageId}
          onAttachmentRetention={onAttachmentRetention}
          onBranch={onBranch}
          onCancelEdit={handleCancelEdit}
          onContinue={onContinue}
          {...(onCreateFeedbackEvalCase === undefined
            ? {}
            : { onCreateFeedbackEvalCase })}
          onCopy={handleCopy}
          onDelete={onDelete}
          onEditValueChange={setEditValue}
          onGenerateSpeech={onGenerateSpeech}
          onPreview={setPreviewAttachment}
          onRate={onRate}
          onRegenerate={onRegenerate}
          onRegenerateWith={onRegenerateWith}
          onFollowUp={onFollowUp}
          regenerateModels={regenerateModels}
          onSelectVariant={onSelectVariant}
          observeStreamingMessage={
            isStreaming && message.id === streamingAssistantMessageId
          }
          onStreamingContentChange={onStreamingContentChange}
          onStartEdit={handleStartEdit}
          onSubmitEdit={handleSubmitEdit}
          positionInSet={index + 1}
          previousVariantId={variants?.previousLeafMessageId}
          rating={feedback[message.id]?.rating}
          reasoning={isLast ? reasoning : undefined}
          runActivities={isLast ? runActivities : noActivities}
          runWait={isLast ? runWait : undefined}
          setSize={messages.length}
          showContinueButton={showContinueButton}
          showFollowUps={showFollowUps}
          showMessageTimestamps={showMessageTimestamps}
          showRunStatus={showRunStatus}
          chatAccess={chatAccess}
          agentName={agentName}
          toolCalls={isLast ? toolCalls : noToolCalls}
          variantIndex={variants?.index}
          variantTotal={variants?.total}
        />
      );
    },
    [
      activeVoiceProfileId,
      agentName,
      authorName,
      chatAccess,
      citations,
      copiedId,
      editValue,
      editingId,
      feedback,
      handleCancelEdit,
      handleCopy,
      handleStartEdit,
      handleSubmitEdit,
      isGeneratingSpeech,
      isStreaming,
      messages.length,
      modelDisplayNames,
      onAttachmentRetention,
      onBranch,
      onContinue,
      onCreateFeedbackEvalCase,
      onDelete,
      onFollowUp,
      onGenerateSpeech,
      onRate,
      onRegenerate,
      onRegenerateWith,
      onSelectVariant,
      onStreamingContentChange,
      reasoning,
      regenerateModels,
      runActivities,
      runWait,
      selectedModelId,
      showContinueButton,
      showFollowUps,
      showMessageModelLabel,
      showMessageTimestamps,
      showRunStatus,
      speechArtifacts,
      speechMessageId,
      streamingAssistantMessageId,
      toolCalls,
      variantsByMessageId,
    ],
  );

  return (
    <>
      <TranscriptWindow
        accessibleDescription={t("fullTranscriptModeDescription")}
        estimateSize={estimateSize}
        feedLabel={t("conversationTranscript")}
        getScrollElement={getScrollElement}
        items={messages}
        renderItem={renderMessage}
        showAllLabel={t("showAllLoadedMessages")}
        useWindowedLabel={t("useWindowedTranscript")}
        windowedDescription={t("windowedTranscriptModeDescription")}
      />
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

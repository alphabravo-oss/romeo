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
import type {
  ChatCitation,
  ChatReasoning,
  ChatRunActivity,
} from "./useWorkspaceController";
import { FormDialog } from "./FormDialog";
import { previewUrlForAttachment } from "./ChatMessageActions";
import { ChatMessageRow } from "./ChatMessageRow";
import type { MessageVariants } from "./message-tree";

// Frozen empties handed to every row but the last. Run state (activities,
// citations, tool calls) belongs to the streaming answer alone, and a fresh []
// per row would defeat ChatMessageRow's memo on every token.
const noActivities: ChatRunActivity[] = [];
const noCitations: ChatCitation[] = [];
const noToolCalls: ChatToolCall[] = [];

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
  onSelectVariant,
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
  onSelectVariant: (messageId: string) => void;
  reasoning: ChatReasoning | undefined;
  runActivities: ChatRunActivity[];
  speechArtifacts: Record<string, SpeechArtifact>;
  speechMessageId: string | undefined;
  toolCalls: ChatToolCall[];
  variantsByMessageId: Record<string, MessageVariants>;
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

  return (
    <>
      <div className="rm-message-list">
        {messages.map((message, index) => {
          const isLast = index === messages.length - 1;
          const isThinking =
            message.role === "assistant" &&
            message.content.length === 0 &&
            isStreaming;
          // Flattened to scalars: variantsByMessageId is rebuilt whenever the
          // transcript is, which during a stream is once per token.
          const variants = variantsByMessageId[message.id];
          return (
            <ChatMessageRow
              activeVoiceProfileId={activeVoiceProfileId}
              agentName={agentName}
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
              nextVariantId={variants?.siblingIds[variants.index + 1]}
              onAttachmentRetention={onAttachmentRetention}
              onBranch={onBranch}
              onCancelEdit={handleCancelEdit}
              onContinue={onContinue}
              onCopy={handleCopy}
              onDelete={onDelete}
              onEditValueChange={setEditValue}
              onGenerateSpeech={onGenerateSpeech}
              onPreview={setPreviewAttachment}
              onRate={onRate}
              onRegenerate={onRegenerate}
              onSelectVariant={onSelectVariant}
              onStartEdit={handleStartEdit}
              onSubmitEdit={handleSubmitEdit}
              previousVariantId={variants?.siblingIds[variants.index - 1]}
              rating={feedback[message.id]?.rating}
              reasoning={isLast ? reasoning : undefined}
              runActivities={isLast ? runActivities : noActivities}
              toolCalls={isLast ? toolCalls : noToolCalls}
              variantIndex={variants?.index}
              variantTotal={variants?.total}
            />
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

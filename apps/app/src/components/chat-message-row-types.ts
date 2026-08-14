import type {
  Message,
  MessageAttachment,
  SpeechArtifact,
} from "../features/types";
import type {
  ChatCitation,
  ChatReasoning,
  ChatRunActivity,
  ChatRunWait,
} from "../lib/run-registry";
import type { ChatToolCall } from "../lib/run-tool-calls";

export interface ChatMessageRowProps {
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
  positionInSet: number;
  setSize: number;
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
  onCreateFeedbackEvalCase?: (messageId: string) => void;
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
  observeStreamingMessage: boolean;
  onStreamingContentChange: () => void;
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
  variantIndex: number | undefined;
  variantTotal: number | undefined;
}

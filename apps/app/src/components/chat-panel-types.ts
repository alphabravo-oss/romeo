import type { FormEvent } from "react";

import type { RunContextPreview } from "../features/chat";
import type { ChatSuggestion } from "../features/chat-experience";
import type { FileObject } from "../features/files";
import type { Agent, AgentGalleryItem } from "../features/managed-models";
import type { QueuedChatTurn } from "../features/runs";
import type {
  BaseModel,
  Message,
  MessageFeedbackState,
  Provider,
  SpeechArtifact,
} from "../features/types";
import type {
  ChatCitation,
  ChatReasoning,
  ChatRunActivity,
  PendingDocumentAttachment,
  PendingImageAttachment,
} from "./workspace-controller-types";
import type { ChatRunWait } from "../lib/run-registry";
import type { ChatToolCall } from "../lib/run-tool-calls";
import type { MessageBranchVariants } from "../lib/message-page-query";
import type { ComposerReasoningMode } from "./composer-reasoning-policy";

export interface ChatPanelProps {
  activeVoiceProfileId: string | undefined;
  activation: {
    assistantReady: boolean;
    conversationComplete: boolean;
    isAdmin: boolean;
    modelReady: boolean;
    providerReady: boolean;
  };
  activeAgent: Pick<Agent, "avatarUrl" | "icon" | "name"> | undefined;
  activeChatId: string | undefined;
  chatTitle: string | undefined;
  /**
   * Selected model name for the next turn: custom model when one is picked,
   * otherwise the base model. Heads an empty chat; undefined is a neutral title.
   */
  nextTurnAuthorName: string | undefined;
  /**
   * Custom model name for rows already on screen, when it differs from the
   * base model. Undefined when the base model is the identity.
   */
  transcriptAuthorName: string | undefined;
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
  hasOlderMessages: boolean;
  isLoadingOlderMessages: boolean;
  isTemporaryChat: boolean;
  queuedTurns: QueuedChatTurn[];
  isTranscribingVoice: boolean;
  knowledgeBaseIdsOverride: string[] | undefined;
  messages: Message[];
  messageFeedback: Record<string, MessageFeedbackState>;
  /** Every model known to the workspace; the composer filters to enabled ones. */
  models: BaseModel[];
  modelDisplayNames: Record<string, string>;
  providers: Provider[];
  promptSuggestions: ChatSuggestion[];
  /** The model that will answer the next message in this chat. */
  selectedModelId: string | undefined;
  systemPrompt: string | undefined;
  defaultModelId: string | undefined;
  /** Model on the latest assistant reply in this branch, if known. */
  lastReplyModelId: string | undefined;
  customModels?: AgentGalleryItem[];
  selectedCustomModelId?: string;
  onSelectCustomModel?: (agentId: string, baseModelId: string) => void;
  onSelectModel: (modelId: string) => void;
  onToggleDefaultModel: (modelId: string) => void;
  webSearchEnabled: boolean;
  agenticRagAvailable: boolean;
  agenticRagForced: boolean;
  agenticRagEnabled: boolean;
  routingMode: "selected" | "economy";
  researchMode: "standard" | "deep";
  reasoningMode: ComposerReasoningMode;
  workspaceId: string | undefined;
  onAttachFiles: (files: File[]) => void;
  onAttachExistingFile: (file: FileObject) => void;
  onAddUrl: (url: string) => void;
  onCancel: () => void;
  onCancelQueuedTurn: (turn: QueuedChatTurn) => void;
  onBranch: (messageId: string) => void;
  onContinue: () => void;
  onCreateFeedbackEvalCase?: (messageId: string) => void;
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
  onLoadOlderMessages: () => Promise<unknown>;
  onKnowledgeBaseIdsChange: (knowledgeBaseIds: string[] | undefined) => void;
  onEditAndResend: (messageId: string, content: string) => Promise<boolean>;
  onRateMessage: (
    messageId: string,
    rating: "negative" | "none" | "positive",
    reasonCode?: string,
  ) => void;
  chatAccess?: "owner" | "write" | "read";
  legalHoldUntil?: string | undefined;
  onOpenSourceChat?: ((sourceChatId: string) => void) | undefined;
  onRegenerate: () => void;
  onRegenerateWith: (input: {
    modelId?: string;
    mode?: "again" | "shorter";
  }) => void;
  onFollowUp: (prompt: string) => void;
  regenerateModels: Array<{ id: string; label: string }>;
  onShareChat: (() => void) | undefined;
  onExportChatMarkdown: (() => void) | undefined;
  onCancelAttachment: (attachmentId: string) => void;
  onMoveDocumentAttachment: (attachmentId: string, direction: -1 | 1) => void;
  onMoveImageAttachment: (attachmentId: string, direction: -1 | 1) => void;
  onRemoveImageAttachment: (attachmentId: string) => void;
  onRemoveDocumentAttachment: (attachmentId: string) => void;
  onRetryDocumentAttachment: (attachmentId: string) => void;
  onSelectDocumentPage: (attachmentId: string, page: number) => void;
  onRemoveUrl: (url: string) => void;
  onSelectVariant: (messageId: string) => void;
  onToggleWebSearch: (enabled: boolean) => void;
  onToggleAgenticRag: (enabled: boolean) => void;
  onRoutingModeChange: (mode: "selected" | "economy") => void;
  onResearchModeChange: (mode: "standard" | "deep") => void;
  onReasoningModeChange: (mode: ComposerReasoningMode) => void;
  onTranscribeAudio: (blob: Blob) => Promise<void>;
  onTranscriptionError: (message: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  reasoning: ChatReasoning | undefined;
  runActivities: ChatRunActivity[];
  runWait: ChatRunWait | undefined;
  speechArtifacts: Record<string, SpeechArtifact>;
  speechMessageId: string | undefined;
  toolCalls: ChatToolCall[];
  variantsByMessageId: Record<string, MessageBranchVariants>;
}

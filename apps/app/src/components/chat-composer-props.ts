import type { FormEvent } from "react";

import type { RunContextPreview } from "../features/chat";
import type { FileObject } from "../features/files";
import type { AgentGalleryItem } from "../features/managed-models";
import type { BaseModel, Message, Provider } from "../features/types";
import type {
  PendingDocumentAttachment,
  PendingImageAttachment,
} from "./useWorkspaceAttachments";

export interface ChatComposerProps {
  attachedUrls: string[];
  /** Effective chat ACL; read disables send/attach/web-search/edit chrome. */
  chatAccess?: "owner" | "write" | "read";
  canInspectContext: boolean;
  contextPreview: RunContextPreview | undefined;
  documentAttachments: PendingDocumentAttachment[];
  draft: string;
  error: string | undefined;
  imageAttachments: PendingImageAttachment[];
  isInspectingContext: boolean;
  isStreaming: boolean;
  isTemporaryChat: boolean;
  isTranscribingVoice: boolean;
  /**
   * Per-turn knowledge override. `undefined` uses the custom model's bindings;
   * an array (including empty) is sent as `knowledgeBaseIds` on startRun.
   */
  knowledgeBaseIdsOverride: string[] | undefined;
  messageCount: number;
  messages: Message[];
  models: BaseModel[];
  systemPrompt: string | undefined;
  defaultModelId: string | undefined;
  lastReplyModelId: string | undefined;
  onAddUrl: (url: string) => void;
  onAttachExistingFile: (file: FileObject) => void;
  onAttachFiles: (files: File[]) => void;
  onCancel: () => void;
  onDraftChange: (value: string) => void;
  onGenerateImages: (input: {
    modelId: string;
    prompt: string;
    size: "1024x1024" | "1024x1536" | "1536x1024";
  }) => void;
  onInspectContext: () => void;
  onKnowledgeBaseIdsChange: (knowledgeBaseIds: string[] | undefined) => void;
  onRemoveDocumentAttachment: (attachmentId: string) => void;
  onRemoveImageAttachment: (attachmentId: string) => void;
  onRemoveUrl: (url: string) => void;
  customModels?: AgentGalleryItem[];
  selectedCustomModelId?: string;
  onSelectCustomModel?: (agentId: string, baseModelId: string) => void;
  onSelectModel: (modelId: string) => void;
  onToggleDefaultModel: (modelId: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onToggleWebSearch: (enabled: boolean) => void;
  onToggleAgenticRag: (enabled: boolean) => void;
  onTranscribeAudio: (blob: Blob) => Promise<void>;
  onTranscriptionError: (message: string) => void;
  providers: Provider[];
  selectedModelId: string | undefined;
  /** Enter submits; Shift+Enter newline. When false, Ctrl/Cmd+Enter submits. */
  enterToSend: boolean;
  webSearchEnabled: boolean;
  agenticRagAvailable: boolean;
  agenticRagForced: boolean;
  agenticRagEnabled: boolean;
  workspaceId: string | undefined;
}

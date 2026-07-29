import type { FormEvent } from "react";

import type { FileObject } from "../features/files";
import type { QueuedChatTurn } from "../features/runs";
import type { BaseModel, Provider } from "../features/types";
import type {
  PendingDocumentAttachment,
  PendingImageAttachment,
} from "./useWorkspaceAttachments";

export interface ChatComposerProps {
  attachedUrls: string[];
  canInspectContext: boolean;
  canOverrideModel: boolean;
  documentAttachments: PendingDocumentAttachment[];
  draft: string;
  error: string | undefined;
  imageAttachments: PendingImageAttachment[];
  isInspectingContext: boolean;
  isStreaming: boolean;
  isTemporaryChat: boolean;
  isTranscribingVoice: boolean;
  messageCount: number;
  models: BaseModel[];
  onAddUrl: (url: string) => void;
  onAttachExistingFile: (file: FileObject) => void;
  onAttachFiles: (files: File[]) => void;
  onCancel: () => void;
  onCancelQueuedTurn: (turnId: string) => void;
  onDraftChange: (value: string) => void;
  onGenerateImages: (input: {
    modelId: string;
    prompt: string;
    size: "1024x1024" | "1024x1536" | "1536x1024";
  }) => void;
  onInspectContext: () => void;
  onRemoveDocumentAttachment: (attachmentId: string) => void;
  onRemoveImageAttachment: (attachmentId: string) => void;
  onRemoveUrl: (url: string) => void;
  onSelectModel: (modelId: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onToggleWebSearch: (enabled: boolean) => void;
  onTranscribeAudio: (blob: Blob) => Promise<void>;
  onTranscriptionError: (message: string) => void;
  providers: Provider[];
  queuedTurns: QueuedChatTurn[];
  selectedModelId: string | undefined;
  webSearchEnabled: boolean;
  workspaceId: string | undefined;
}

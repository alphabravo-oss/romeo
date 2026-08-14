import type { QueryClient } from "@tanstack/react-query";
import type { Dispatch, SetStateAction } from "react";

import type { Chat, Message } from "../features/types";
import type { MessageKey } from "../lib/i18n";
import type {
  PendingDocumentAttachment,
  PendingImageAttachment,
} from "./useWorkspaceAttachments";
import type { ComposerReasoningMode } from "./composer-reasoning-policy";

export interface WorkspaceTurnActionsOptions {
  activeAgentId: string | undefined;
  activeChatId: string | undefined;
  chats: Chat[];
  allMessages: Message[];
  autoTitleEnabled: boolean;
  appendMessage: (
    chatId: string,
    role: Message["role"],
    content: string,
    attachments?: Message["attachments"],
    parentId?: string,
    messageId?: string,
  ) => string;
  attachedUrls: string[];
  clearPendingAttachments: () => void;
  documentAttachments: PendingDocumentAttachment[];
  draft: string;
  imageAttachments: PendingImageAttachment[];
  isStreaming: boolean;
  knowledgeBaseIdsOverride?: string[];
  messages: Message[];
  onBranchSelection?: (chatId: string, leafMessageId: string) => void;
  onChatCreated?: (chatId: string) => void;
  queryClient: QueryClient;
  refreshUsageControls: () => Promise<void>;
  restoreMessages: (chatId: string, snapshot: readonly Message[]) => void;
  restorePendingAttachments: (
    images: readonly PendingImageAttachment[],
    documents: readonly PendingDocumentAttachment[],
  ) => void;
  selectedModelId: string | undefined;
  setActiveChatId: Dispatch<SetStateAction<string | undefined>>;
  setAttachedUrls: Dispatch<SetStateAction<string[]>>;
  setDraft: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string | undefined>>;
  setIsDraftingNewChat: Dispatch<SetStateAction<boolean>>;
  setTemporaryNextChat: Dispatch<SetStateAction<boolean>>;
  syncPersistedMessages: (
    chatId: string,
    optimisticMessageIds?: readonly string[],
  ) => Promise<void>;
  t: (key: MessageKey) => string;
  temporaryNextChat: boolean;
  webSearchEnabled: boolean;
  agenticRagEnabled: boolean;
  routingMode: "selected" | "economy";
  researchMode: "standard" | "deep";
  reasoningMode: ComposerReasoningMode;
  workspaceId: string | undefined;
}

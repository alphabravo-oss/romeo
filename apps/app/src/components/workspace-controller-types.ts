export interface WorkspaceControllerOptions {
  onAgentSelection?: (agentId: string) => void;
  onChatSelection?: (
    chatId: string | undefined,
    options?: { replace: boolean },
  ) => void;
  onBranchSelection?: (
    leafMessageId: string | undefined,
    options?: { replace: boolean },
  ) => void;
  requestedAgentId?: string;
  requestedChatId?: string;
  requestedLeafMessageId?: string;
}

export type {
  PendingDocumentAttachment,
  PendingImageAttachment,
} from "./useWorkspaceAttachments";
export type {
  ChatCitation,
  ChatReasoning,
  ChatRunActivity,
  ChatRunWait,
} from "../lib/run-registry";

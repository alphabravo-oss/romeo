import type { DataDeletionPreview, DataDeletionResult } from "./governance";

export interface Chat {
  id: string;
  orgId: string;
  workspaceId: string;
  title: string;
  createdBy: string;
  archivedAt?: string;
  legalHoldUntil?: string;
  legalHoldReason?: string;
  updatedAt: string;
}

export interface CreateChatInput {
  workspaceId: string;
  title: string;
}

export interface ListChatsInput {
  workspaceId?: string;
  archived?: "active" | "all" | "archived";
}

export interface UpdateChatInput {
  title?: string;
}

export interface ForkChatInput {
  title?: string;
  throughMessageId?: string;
  includeAttachments?: boolean;
}

export type ChatDeletionPreview = DataDeletionPreview;

export type ChatDeletionResult = DataDeletionResult;

export interface DeleteChatInput {
  confirmChatId: string;
}

export interface ChatTag {
  id: string;
  orgId: string;
  userId: string;
  slug: string;
  name: string;
  meta?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AssignChatTagInput {
  name: string;
}

export type MessageFeedbackRating = "negative" | "positive";

export interface MessageFeedbackState {
  chatId: string;
  messageId: string;
  configured: boolean;
  rating?: MessageFeedbackRating;
  reasonCode?: string;
  createdAt?: string;
  updatedAt?: string;
  redaction: {
    freeTextReturned: false;
    messageContentReturned: false;
    rawUsageMetadataReturned: false;
    reviewerIdentityReturned: false;
  };
}

export interface UpdateMessageFeedbackInput {
  rating: MessageFeedbackRating | "none";
  reasonCode?: string;
}

export interface UpdateChatLegalHoldInput {
  legalHoldUntil?: string | null;
  legalHoldReason?: string;
}

export interface Message {
  id: string;
  chatId: string;
  role: "assistant" | "system" | "tool" | "user";
  content: string;
  attachments?: MessageAttachment[];
  createdAt: string;
}

export interface MessageAttachment {
  id: string;
  messageId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  kind: "image";
  previewUrl?: string;
}

export interface ChatComment {
  id: string;
  orgId: string;
  chatId: string;
  authorId: string;
  body: string;
  mentionedUserIds: string[];
  createdAt: string;
}

export interface CreateChatCommentInput {
  body: string;
}

export interface RunRecord {
  id: string;
  orgId: string;
  workspaceId: string;
  chatId: string;
  agentId: string;
  agentVersionId: string;
  modelId: string;
  providerId: string;
  status:
    | "cancelled"
    | "completed"
    | "failed"
    | "queued"
    | "running"
    | "waiting_tool_approval";
  createdBy: string;
  createdAt: string;
  completedAt?: string;
}

export type RunEventType =
  | "message.completed"
  | "message.delta"
  | "message.started"
  | "retrieval.completed"
  | "run.cancelled"
  | "run.completed"
  | "run.continuing"
  | "run.failed"
  | "run.started"
  | "run.waiting_tool_approval"
  | "run.waiting_tool_dispatch"
  | "tool.requested"
  | "tool.approval_required"
  | "tool.completed"
  | "tool.failed"
  | "tool.started";

export interface RunEvent<TData = unknown> {
  id: string;
  runId: string;
  sequence: number;
  type: RunEventType;
  data: TData;
  createdAt: string;
}

export interface StartRunInput {
  chatId: string;
  agentId: string;
  content: string;
  modelId?: string;
  /**
   * Id of a message in `chatId` to cut prior history at, exclusive. Regenerate sets it to the
   * message being re-run so the pair it replaces is not fed back to the model. Omit to send the
   * chat's full history.
   */
  historyBoundaryMessageId?: string;
  attachments?: Array<{
    dataBase64: string;
    fileName: string;
    mimeType: "image/gif" | "image/jpeg" | "image/png" | "image/webp";
    sizeBytes: number;
  }>;
}

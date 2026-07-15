export interface Chat {
  id: string;
  title: string;
  workspaceId: string;
  archivedAt?: string;
  legalHoldUntil?: string;
  legalHoldReason?: string;
  updatedAt: string;
}

export type ChatArchiveFilter = "active" | "all" | "archived";

export interface Message {
  id: string;
  role: "system" | "user" | "assistant" | "tool";
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
  chatId: string;
  authorId: string;
  body: string;
  mentionedUserIds: string[];
  createdAt: string;
}

export interface RunRecord {
  id: string;
  status:
    | "queued"
    | "running"
    | "waiting_tool_approval"
    | "cancelled"
    | "completed"
    | "failed";
  agentVersionId: string;
}

export interface RunEvent {
  id: string;
  runId: string;
  sequence: number;
  type:
    | "run.started"
    | "message.started"
    | "message.delta"
    | "message.completed"
    | "retrieval.completed"
    | "tool.started"
    | "tool.approval_required"
    | "tool.completed"
    | "tool.failed"
    | "run.cancelled"
    | "run.completed"
    | "run.continuing"
    | "run.failed"
    | "run.waiting_tool_approval"
    | "run.waiting_tool_dispatch"
    | "tool.requested";
  data: unknown;
  createdAt: string;
}

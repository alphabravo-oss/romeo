export type {
  Chat,
  ChatComment,
  ChatExport,
  Message,
  MessageAttachment,
  MessageCitation,
  MessageFeedbackState,
} from "@romeo/api-client/generated/sdk";

export type ChatArchiveFilter = "active" | "all" | "archived";

export interface ChatPage {
  items: import("@romeo/api-client/generated/sdk").Chat[];
  limit: number;
  offset: number;
  total: number;
  hasMore: boolean;
}

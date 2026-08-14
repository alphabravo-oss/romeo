import type { PrincipalType, ResourceType } from "@romeo/auth";

export type FavoritableResourceType = Extract<
  ResourceType,
  "agent" | "chat" | "knowledge_base" | "model"
>;
export type FolderItemResourceType = Extract<
  ResourceType,
  "agent" | "chat" | "knowledge_base"
>;

export type PromptTemplateVisibility = "marketplace" | "private" | "workspace";

export interface PromptTemplate {
  id: string;
  orgId: string;
  workspaceId: string;
  name: string;
  description?: string;
  body: string;
  tags: string[];
  visibility: PromptTemplateVisibility;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceFolder {
  id: string;
  orgId: string;
  workspaceId: string;
  name: string;
  parentId?: string;
  meta?: Record<string, unknown>;
  data?: Record<string, unknown>;
  isExpanded?: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceFolderItem {
  id: string;
  orgId: string;
  workspaceId: string;
  folderId: string;
  resourceType: FolderItemResourceType;
  resourceId: string;
  createdAt: string;
}

export interface AuthorizedWorkspaceFolderItemsBatchInput {
  canReadAgents: boolean;
  canReadChats: boolean;
  canReadKnowledgeBases: boolean;
  folderIds: string[];
  groupIds: string[];
  isAdmin: boolean;
  limitPerFolder: number;
  orgId: string;
  principalId: string;
  principalType: Extract<PrincipalType, "service_account" | "user">;
  workspaceId: string;
}

export interface AuthorizedWorkspaceFoldersByIdsInput {
  folderIds: string[];
  groupIds: string[];
  isAdmin: boolean;
  orgId: string;
  principalId: string;
  principalType: Extract<PrincipalType, "service_account" | "user">;
  workspaceId: string;
}

export interface WorkspaceFolderItemsBatchGroup {
  folderId: string;
  hasMore: boolean;
  items: WorkspaceFolderItem[];
}

export interface ResourceFavorite {
  id: string;
  orgId: string;
  userId: string;
  resourceType: FavoritableResourceType;
  resourceId: string;
  createdAt: string;
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

export type NotificationType =
  | "chat_mention"
  | "support_impersonation_request_created"
  | "support_impersonation_request_approved"
  | "support_impersonation_request_rejected"
  | "support_impersonation_session_created"
  | "support_impersonation_session_revoked";
export type NotificationResourceType =
  | "chat"
  | "support_impersonation_request"
  | "support_impersonation_session";
export type NotificationDeliveryChannelType =
  | "email"
  | "mobile_push"
  | "pagerduty"
  | "slack"
  | "teams"
  | "webhook";
export type NotificationDeliveryStatus =
  | "disabled"
  | "failed"
  | "pending"
  | "sent";

export interface UserNotification {
  id: string;
  orgId: string;
  userId: string;
  type: NotificationType;
  actorId: string;
  resourceType: NotificationResourceType;
  resourceId: string;
  metadata: Record<string, unknown>;
  readAt?: string;
  createdAt: string;
}

export interface NotificationDeliveryChannel {
  id: string;
  orgId: string;
  userId: string;
  type: NotificationDeliveryChannelType;
  name: string;
  config: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationDelivery {
  id: string;
  orgId: string;
  userId: string;
  notificationId: string;
  channelId: string;
  status: NotificationDeliveryStatus;
  attemptCount: number;
  errorCode?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  deliveredAt?: string;
}

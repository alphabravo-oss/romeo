import type { Agent } from "./agents";

export type SharePrincipalType = "group" | "service_account" | "user";
export type SharePermission = "read" | "run" | "use" | "write";
export type FavoritableResourceType = "agent" | "chat" | "knowledge_base";
export type FolderItemResourceType = "agent" | "chat" | "knowledge_base";
export type PromptTemplateVisibility = "marketplace" | "private" | "workspace";

export interface ShareResourceInput {
  principalType: SharePrincipalType;
  principalId: string;
  permissions: SharePermission[];
}

export interface ShareTarget {
  principalType: SharePrincipalType;
  principalId: string;
  label: string;
  detail?: string;
}

export interface AgentGalleryItem extends Agent {
  favorite: boolean;
}

export interface ResourceFavorite {
  id: string;
  orgId: string;
  userId: string;
  resourceType: FavoritableResourceType;
  resourceId: string;
  createdAt: string;
}

export interface CreateFavoriteInput {
  resourceType: FavoritableResourceType;
  resourceId: string;
}

export interface WorkspaceFolder {
  id: string;
  orgId: string;
  workspaceId: string;
  name: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  data?: Record<string, unknown>;
  isExpanded?: boolean;
  meta?: Record<string, unknown>;
  parentId?: string;
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

export interface CreatePromptTemplateInput {
  workspaceId: string;
  name: string;
  body: string;
  description?: string;
  tags?: string[];
  visibility?: PromptTemplateVisibility;
}

export interface UpdatePromptTemplateInput {
  name?: string;
  body?: string;
  description?: string | null;
  tags?: string[];
  visibility?: PromptTemplateVisibility;
}

export interface CreateFolderInput {
  workspaceId: string;
  name: string;
  data?: Record<string, unknown> | null;
  isExpanded?: boolean;
  meta?: Record<string, unknown> | null;
  parentId?: string | null;
}

export interface UpdateFolderInput {
  data?: Record<string, unknown> | null;
  isExpanded?: boolean;
  meta?: Record<string, unknown> | null;
  name?: string;
  parentId?: string | null;
}

export interface CreateFolderItemInput {
  resourceType: FolderItemResourceType;
  resourceId: string;
}

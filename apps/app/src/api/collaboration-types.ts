import type { Agent } from "./agent-types";

export interface ResourceFavorite {
  id: string;
  resourceType: "agent" | "chat" | "knowledge_base";
  resourceId: string;
  createdAt: string;
}

export interface AgentGalleryItem extends Agent {
  favorite: boolean;
}

export interface ShareTarget {
  principalType: "group" | "service_account" | "user";
  principalId: string;
  label: string;
  detail?: string;
}

export type FolderItemResourceType = "agent" | "chat" | "knowledge_base";

export interface WorkspaceFolder {
  id: string;
  workspaceId: string;
  name: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceFolderItem {
  id: string;
  folderId: string;
  resourceType: FolderItemResourceType;
  resourceId: string;
  createdAt: string;
}

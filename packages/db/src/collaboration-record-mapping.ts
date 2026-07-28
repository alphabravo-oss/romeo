import {
  promptTemplates,
  resourceFavorites,
  workspaceFolderItems,
  workspaceFolders,
} from "./schema";
import { optionalIsoString, toIsoString } from "./repository-mapping";

export type FavoritableResourceTypeRecord =
  | "agent"
  | "chat"
  | "knowledge_base"
  | "model";
export type FolderItemResourceTypeRecord = "agent" | "chat" | "knowledge_base";
export type PromptTemplateVisibilityRecord =
  | "marketplace"
  | "private"
  | "workspace";

export interface PromptTemplateRecord {
  id: string;
  orgId: string;
  workspaceId: string;
  name: string;
  description?: string;
  body: string;
  tags: string[];
  visibility: PromptTemplateVisibilityRecord;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceFolderRecord {
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

export interface WorkspaceFolderItemRecord {
  id: string;
  orgId: string;
  workspaceId: string;
  folderId: string;
  resourceType: FolderItemResourceTypeRecord;
  resourceId: string;
  createdAt: string;
}

export interface ResourceFavoriteRecord {
  id: string;
  orgId: string;
  userId: string;
  resourceType: FavoritableResourceTypeRecord;
  resourceId: string;
  createdAt: string;
}

export function toPromptTemplateRecord(
  row: typeof promptTemplates.$inferSelect,
): PromptTemplateRecord {
  const template: PromptTemplateRecord = {
    id: row.id,
    orgId: row.orgId,
    workspaceId: row.workspaceId,
    name: row.name,
    body: row.body,
    tags: row.tags,
    visibility: asPromptTemplateVisibility(row.visibility),
    createdBy: row.createdBy,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
  const description = optionalIsoString(row.description);
  if (description !== undefined) template.description = description;
  return template;
}

export function toResourceFavoriteRecord(
  row: typeof resourceFavorites.$inferSelect,
): ResourceFavoriteRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    userId: row.userId,
    resourceType: asFavoritableResourceType(row.resourceType),
    resourceId: row.resourceId,
    createdAt: toIsoString(row.createdAt),
  };
}

export function toWorkspaceFolderRecord(
  row: typeof workspaceFolders.$inferSelect,
): WorkspaceFolderRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    workspaceId: row.workspaceId,
    name: row.name,
    ...(row.parentId === null ? {} : { parentId: row.parentId }),
    ...(row.meta === null ? {} : { meta: row.meta }),
    ...(row.data === null ? {} : { data: row.data }),
    isExpanded: row.isExpanded,
    createdBy: row.createdBy,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

export function toWorkspaceFolderItemRecord(
  row: typeof workspaceFolderItems.$inferSelect,
): WorkspaceFolderItemRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    workspaceId: row.workspaceId,
    folderId: row.folderId,
    resourceType: asFolderItemResourceType(row.resourceType),
    resourceId: row.resourceId,
    createdAt: toIsoString(row.createdAt),
  };
}

export function toPromptTemplateInsert(
  record: PromptTemplateRecord,
): typeof promptTemplates.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    workspaceId: record.workspaceId,
    name: record.name,
    description: record.description ?? null,
    body: record.body,
    tags: record.tags,
    visibility: record.visibility,
    createdBy: record.createdBy,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}

export function toResourceFavoriteInsert(
  record: ResourceFavoriteRecord,
): typeof resourceFavorites.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    userId: record.userId,
    resourceType: record.resourceType,
    resourceId: record.resourceId,
    createdAt: new Date(record.createdAt),
  };
}

export function toWorkspaceFolderInsert(
  record: WorkspaceFolderRecord,
): typeof workspaceFolders.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    workspaceId: record.workspaceId,
    name: record.name,
    parentId: record.parentId ?? null,
    meta: record.meta ?? null,
    data: record.data ?? null,
    isExpanded: record.isExpanded ?? false,
    createdBy: record.createdBy,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}

export function toWorkspaceFolderItemInsert(
  record: WorkspaceFolderItemRecord,
): typeof workspaceFolderItems.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    workspaceId: record.workspaceId,
    folderId: record.folderId,
    resourceType: record.resourceType,
    resourceId: record.resourceId,
    createdAt: new Date(record.createdAt),
  };
}

function asPromptTemplateVisibility(
  value: string,
): PromptTemplateVisibilityRecord {
  return value === "marketplace" || value === "private" || value === "workspace"
    ? value
    : "private";
}

function asFavoritableResourceType(
  value: string,
): FavoritableResourceTypeRecord {
  return value === "agent" ||
    value === "chat" ||
    value === "knowledge_base" ||
    value === "model"
    ? value
    : "agent";
}

function asFolderItemResourceType(value: string): FolderItemResourceTypeRecord {
  return value === "agent" || value === "chat" || value === "knowledge_base"
    ? value
    : "agent";
}

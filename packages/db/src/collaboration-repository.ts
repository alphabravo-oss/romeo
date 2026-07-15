import { and, asc, desc, eq } from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import {
  promptTemplates,
  resourceFavorites,
  workspaceFolderItems,
  workspaceFolders,
} from "./schema";
import {
  asStringArray,
  optionalIsoString,
  toIsoString,
} from "./repository-mapping";

export type FavoritableResourceTypeRecord = "agent" | "chat" | "knowledge_base";
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

export class PgCollaborationRepository {
  constructor(private readonly db: RomeoDatabase) {}

  async listPromptTemplates(
    orgId: string,
    workspaceId?: string,
  ): Promise<PromptTemplateRecord[]> {
    const rows = await this.db
      .select()
      .from(promptTemplates)
      .where(
        workspaceId === undefined
          ? eq(promptTemplates.orgId, orgId)
          : and(
              eq(promptTemplates.orgId, orgId),
              eq(promptTemplates.workspaceId, workspaceId),
            ),
      )
      .orderBy(desc(promptTemplates.updatedAt), asc(promptTemplates.id));
    return rows.map(toPromptTemplateRecord);
  }

  async getPromptTemplate(
    promptTemplateId: string,
  ): Promise<PromptTemplateRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(promptTemplates)
      .where(eq(promptTemplates.id, promptTemplateId))
      .limit(1);
    return row === undefined ? undefined : toPromptTemplateRecord(row);
  }

  async createPromptTemplate(
    promptTemplate: PromptTemplateRecord,
  ): Promise<PromptTemplateRecord> {
    const [row] = await this.db
      .insert(promptTemplates)
      .values(toPromptTemplateInsert(promptTemplate))
      .returning();
    return row === undefined ? promptTemplate : toPromptTemplateRecord(row);
  }

  async updatePromptTemplate(
    promptTemplate: PromptTemplateRecord,
  ): Promise<PromptTemplateRecord> {
    const [row] = await this.db
      .update(promptTemplates)
      .set({
        body: promptTemplate.body,
        description: promptTemplate.description ?? null,
        name: promptTemplate.name,
        tags: promptTemplate.tags,
        updatedAt: new Date(promptTemplate.updatedAt),
        visibility: promptTemplate.visibility,
        workspaceId: promptTemplate.workspaceId,
      })
      .where(eq(promptTemplates.id, promptTemplate.id))
      .returning();
    return row === undefined ? promptTemplate : toPromptTemplateRecord(row);
  }

  async deletePromptTemplate(
    promptTemplateId: string,
  ): Promise<PromptTemplateRecord | undefined> {
    const [existing] = await this.db
      .select()
      .from(promptTemplates)
      .where(eq(promptTemplates.id, promptTemplateId))
      .limit(1);
    if (existing === undefined) return undefined;
    await this.db
      .delete(promptTemplates)
      .where(eq(promptTemplates.id, promptTemplateId));
    return toPromptTemplateRecord(existing);
  }

  async listResourceFavorites(
    orgId: string,
    userId: string,
  ): Promise<ResourceFavoriteRecord[]> {
    const rows = await this.db
      .select()
      .from(resourceFavorites)
      .where(
        and(
          eq(resourceFavorites.orgId, orgId),
          eq(resourceFavorites.userId, userId),
        ),
      )
      .orderBy(desc(resourceFavorites.createdAt), asc(resourceFavorites.id));
    return rows.map(toResourceFavoriteRecord);
  }

  async createResourceFavorite(
    favorite: ResourceFavoriteRecord,
  ): Promise<ResourceFavoriteRecord> {
    const [row] = await this.db
      .insert(resourceFavorites)
      .values(toResourceFavoriteInsert(favorite))
      .onConflictDoNothing({
        target: [
          resourceFavorites.orgId,
          resourceFavorites.userId,
          resourceFavorites.resourceType,
          resourceFavorites.resourceId,
        ],
      })
      .returning();
    if (row !== undefined) return toResourceFavoriteRecord(row);
    const [existing] = await this.db
      .select()
      .from(resourceFavorites)
      .where(
        and(
          eq(resourceFavorites.orgId, favorite.orgId),
          eq(resourceFavorites.userId, favorite.userId),
          eq(resourceFavorites.resourceType, favorite.resourceType),
          eq(resourceFavorites.resourceId, favorite.resourceId),
        ),
      )
      .limit(1);
    return existing === undefined
      ? favorite
      : toResourceFavoriteRecord(existing);
  }

  async deleteResourceFavorite(
    favoriteId: string,
  ): Promise<ResourceFavoriteRecord | undefined> {
    const [existing] = await this.db
      .select()
      .from(resourceFavorites)
      .where(eq(resourceFavorites.id, favoriteId))
      .limit(1);
    if (existing === undefined) return undefined;
    await this.db
      .delete(resourceFavorites)
      .where(eq(resourceFavorites.id, favoriteId));
    return toResourceFavoriteRecord(existing);
  }

  async listWorkspaceFolders(
    orgId: string,
    workspaceId?: string,
  ): Promise<WorkspaceFolderRecord[]> {
    const rows = await this.db
      .select()
      .from(workspaceFolders)
      .where(
        workspaceId === undefined
          ? eq(workspaceFolders.orgId, orgId)
          : and(
              eq(workspaceFolders.orgId, orgId),
              eq(workspaceFolders.workspaceId, workspaceId),
            ),
      )
      .orderBy(desc(workspaceFolders.updatedAt), asc(workspaceFolders.id));
    return rows.map(toWorkspaceFolderRecord);
  }

  async getWorkspaceFolder(
    folderId: string,
  ): Promise<WorkspaceFolderRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(workspaceFolders)
      .where(eq(workspaceFolders.id, folderId))
      .limit(1);
    return row === undefined ? undefined : toWorkspaceFolderRecord(row);
  }

  async createWorkspaceFolder(
    folder: WorkspaceFolderRecord,
  ): Promise<WorkspaceFolderRecord> {
    const [row] = await this.db
      .insert(workspaceFolders)
      .values(toWorkspaceFolderInsert(folder))
      .returning();
    return row === undefined ? folder : toWorkspaceFolderRecord(row);
  }

  async updateWorkspaceFolder(
    folder: WorkspaceFolderRecord,
  ): Promise<WorkspaceFolderRecord> {
    const [row] = await this.db
      .update(workspaceFolders)
      .set({
        name: folder.name,
        parentId: folder.parentId ?? null,
        meta: folder.meta ?? null,
        data: folder.data ?? null,
        isExpanded: folder.isExpanded ?? false,
        updatedAt: new Date(folder.updatedAt),
      })
      .where(eq(workspaceFolders.id, folder.id))
      .returning();
    return row === undefined ? folder : toWorkspaceFolderRecord(row);
  }

  async deleteWorkspaceFolder(
    folderId: string,
  ): Promise<WorkspaceFolderRecord | undefined> {
    const [existing] = await this.db
      .select()
      .from(workspaceFolders)
      .where(eq(workspaceFolders.id, folderId))
      .limit(1);
    if (existing === undefined) return undefined;
    await this.db
      .delete(workspaceFolderItems)
      .where(eq(workspaceFolderItems.folderId, folderId));
    await this.db.delete(workspaceFolders).where(eq(workspaceFolders.id, folderId));
    return toWorkspaceFolderRecord(existing);
  }

  async listWorkspaceFolderItems(
    folderId: string,
  ): Promise<WorkspaceFolderItemRecord[]> {
    const rows = await this.db
      .select()
      .from(workspaceFolderItems)
      .where(eq(workspaceFolderItems.folderId, folderId))
      .orderBy(
        asc(workspaceFolderItems.createdAt),
        asc(workspaceFolderItems.id),
      );
    return rows.map(toWorkspaceFolderItemRecord);
  }

  async createWorkspaceFolderItem(
    item: WorkspaceFolderItemRecord,
  ): Promise<WorkspaceFolderItemRecord> {
    const [row] = await this.db
      .insert(workspaceFolderItems)
      .values(toWorkspaceFolderItemInsert(item))
      .onConflictDoNothing({
        target: [
          workspaceFolderItems.folderId,
          workspaceFolderItems.resourceType,
          workspaceFolderItems.resourceId,
        ],
      })
      .returning();
    if (row !== undefined) return toWorkspaceFolderItemRecord(row);
    const [existing] = await this.db
      .select()
      .from(workspaceFolderItems)
      .where(
        and(
          eq(workspaceFolderItems.folderId, item.folderId),
          eq(workspaceFolderItems.resourceType, item.resourceType),
          eq(workspaceFolderItems.resourceId, item.resourceId),
        ),
      )
      .limit(1);
    return existing === undefined
      ? item
      : toWorkspaceFolderItemRecord(existing);
  }

  async deleteWorkspaceFolderItem(
    itemId: string,
  ): Promise<WorkspaceFolderItemRecord | undefined> {
    const [existing] = await this.db
      .select()
      .from(workspaceFolderItems)
      .where(eq(workspaceFolderItems.id, itemId))
      .limit(1);
    if (existing === undefined) return undefined;
    await this.db
      .delete(workspaceFolderItems)
      .where(eq(workspaceFolderItems.id, itemId));
    return toWorkspaceFolderItemRecord(existing);
  }
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

function toPromptTemplateInsert(
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

function toResourceFavoriteInsert(
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

function toWorkspaceFolderInsert(
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

function toWorkspaceFolderItemInsert(
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
  if (value === "marketplace" || value === "private" || value === "workspace") {
    return value;
  }
  return "private";
}

function asFavoritableResourceType(
  value: string,
): FavoritableResourceTypeRecord {
  if (value === "agent" || value === "chat" || value === "knowledge_base")
    return value;
  return "agent";
}

function asFolderItemResourceType(value: string): FolderItemResourceTypeRecord {
  if (value === "agent" || value === "chat" || value === "knowledge_base")
    return value;
  return "agent";
}

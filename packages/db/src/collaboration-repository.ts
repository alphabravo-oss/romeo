import type { AuthorizedWorkspaceFoldersByIdsInput } from "@romeo/core";
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  or,
  sql,
} from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import {
  promptTemplates,
  resourceGrants,
  resourceFavorites,
  workspaceFolderItems,
  workspaceFolders,
} from "./schema";
import {
  toPromptTemplateInsert,
  toPromptTemplateRecord,
  toResourceFavoriteInsert,
  toResourceFavoriteRecord,
  toWorkspaceFolderInsert,
  toWorkspaceFolderItemInsert,
  toWorkspaceFolderItemRecord,
  toWorkspaceFolderRecord,
  type PromptTemplateRecord,
  type PromptTemplateVisibilityRecord,
  type ResourceFavoriteRecord,
  type WorkspaceFolderItemRecord,
  type WorkspaceFolderRecord,
} from "./collaboration-record-mapping";
import { PgWorkspaceFolderItemBatchRepository } from "./workspace-folder-item-batch-repository";

export type * from "./collaboration-record-mapping";
export {
  toPromptTemplateRecord,
  toResourceFavoriteRecord,
  toWorkspaceFolderItemRecord,
  toWorkspaceFolderRecord,
};

export class PgCollaborationRepository extends PgWorkspaceFolderItemBatchRepository {
  constructor(db: RomeoDatabase) {
    super(db);
  }

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

  async listAuthorizedPromptTemplatesPage(input: {
    groupIds: string[];
    isAdmin: boolean;
    limit: number;
    offset: number;
    orgId: string;
    principalId: string;
    principalType: "service_account" | "user";
    query?: string;
    visibility?: PromptTemplateVisibilityRecord;
    workspaceId: string;
  }): Promise<{ items: PromptTemplateRecord[]; total: number }> {
    const query = input.query?.trim();
    const directPrincipal = and(
      eq(resourceGrants.principalType, input.principalType),
      eq(resourceGrants.principalId, input.principalId),
    );
    const groupPrincipal =
      input.groupIds.length === 0
        ? undefined
        : and(
            eq(resourceGrants.principalType, "group"),
            inArray(resourceGrants.principalId, input.groupIds),
          );
    const where = and(
      eq(promptTemplates.orgId, input.orgId),
      eq(promptTemplates.workspaceId, input.workspaceId),
      input.visibility === undefined
        ? undefined
        : eq(promptTemplates.visibility, input.visibility),
      input.isAdmin
        ? undefined
        : or(
            eq(promptTemplates.createdBy, input.principalId),
            inArray(promptTemplates.visibility, ["workspace", "marketplace"]),
            exists(
              this.db
                .select({ value: sql`1` })
                .from(resourceGrants)
                .where(
                  and(
                    eq(resourceGrants.orgId, input.orgId),
                    eq(resourceGrants.resourceType, "prompt_template"),
                    eq(resourceGrants.resourceId, promptTemplates.id),
                    inArray(resourceGrants.permission, [
                      "read",
                      "use",
                      "write",
                    ]),
                    groupPrincipal === undefined
                      ? directPrincipal
                      : or(directPrincipal, groupPrincipal),
                  ),
                ),
            ),
          ),
      query === undefined || query === ""
        ? undefined
        : or(
            ilike(promptTemplates.name, `%${query}%`),
            ilike(promptTemplates.description, `%${query}%`),
            sql`array_to_string(${promptTemplates.tags}, ' ') ILIKE ${`%${query}%`}`,
          ),
    );
    const [rows, totals] = await Promise.all([
      this.db
        .select()
        .from(promptTemplates)
        .where(where)
        .orderBy(desc(promptTemplates.updatedAt), asc(promptTemplates.id))
        .limit(input.limit)
        .offset(input.offset),
      this.db.select({ value: count() }).from(promptTemplates).where(where),
    ]);
    return {
      items: rows.map(toPromptTemplateRecord),
      total: totals[0]?.value ?? 0,
    };
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

  async listAuthorizedWorkspaceFoldersByIds(
    input: AuthorizedWorkspaceFoldersByIdsInput,
  ): Promise<WorkspaceFolderRecord[]> {
    const folderIds = [...new Set(input.folderIds)].sort().slice(0, 50);
    if (folderIds.length === 0) return [];
    const principalMatch = or(
      and(
        eq(resourceGrants.principalType, input.principalType),
        eq(resourceGrants.principalId, input.principalId),
      ),
      input.groupIds.length === 0
        ? undefined
        : and(
            eq(resourceGrants.principalType, "group"),
            inArray(resourceGrants.principalId, input.groupIds),
          ),
    );
    const folderGrant = exists(
      this.db
        .select({ value: sql`1` })
        .from(resourceGrants)
        .where(
          and(
            eq(resourceGrants.orgId, input.orgId),
            eq(resourceGrants.resourceType, "folder"),
            eq(resourceGrants.resourceId, workspaceFolders.id),
            inArray(resourceGrants.permission, ["read", "write"]),
            principalMatch,
          ),
        ),
    );
    const rows = await this.db
      .select()
      .from(workspaceFolders)
      .where(
        and(
          eq(workspaceFolders.orgId, input.orgId),
          eq(workspaceFolders.workspaceId, input.workspaceId),
          inArray(workspaceFolders.id, folderIds),
          input.isAdmin
            ? undefined
            : or(
                eq(workspaceFolders.createdBy, input.principalId),
                folderGrant,
              ),
        ),
      )
      .orderBy(asc(workspaceFolders.id));
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
    await this.db
      .delete(workspaceFolders)
      .where(eq(workspaceFolders.id, folderId));
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

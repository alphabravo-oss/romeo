import type * as E from "../domain/entities";
import type * as R from "../domain/repository";
import { append, removeById, replaceById } from "./collection-helpers";
import { InMemoryOperationsRepository } from "./in-memory-operations";

export abstract class InMemoryOrganizationRepository extends InMemoryOperationsRepository {
  async listPromptTemplates(
    orgId: string,
    workspaceId?: string,
  ): Promise<E.PromptTemplate[]> {
    return this.data.promptTemplates
      .filter(
        (template) =>
          template.orgId === orgId &&
          (workspaceId === undefined || template.workspaceId === workspaceId),
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async listAuthorizedPromptTemplatesPage(
    input: R.AuthorizedPromptCatalogQuery,
  ): Promise<{ items: E.PromptTemplate[]; total: number }> {
    const query = input.query?.trim().toLocaleLowerCase() ?? "";
    const templates = this.data.promptTemplates
      .filter(
        (template) =>
          template.orgId === input.orgId &&
          template.workspaceId === input.workspaceId,
      )
      .filter(
        (template) =>
          input.visibility === undefined ||
          template.visibility === input.visibility,
      )
      .filter((template) => {
        if (
          input.isAdmin ||
          template.createdBy === input.principalId ||
          template.visibility !== "private"
        )
          return true;
        return this.data.grants.some(
          (grant) =>
            grant.resourceType === "prompt_template" &&
            grant.resourceId === template.id &&
            ["read", "use", "write"].includes(grant.permission) &&
            ((grant.principalType === input.principalType &&
              grant.principalId === input.principalId) ||
              (grant.principalType === "group" &&
                input.groupIds.includes(grant.principalId))),
        );
      })
      .filter(
        (template) =>
          query === "" ||
          [template.name, template.description ?? "", ...template.tags]
            .join(" ")
            .toLocaleLowerCase()
            .includes(query),
      )
      .sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) ||
          left.id.localeCompare(right.id),
      );
    return {
      items: templates.slice(input.offset, input.offset + input.limit),
      total: templates.length,
    };
  }

  async getPromptTemplate(
    promptTemplateId: string,
  ): Promise<E.PromptTemplate | undefined> {
    return this.data.promptTemplates.find(
      (template) => template.id === promptTemplateId,
    );
  }

  async createPromptTemplate(
    promptTemplate: E.PromptTemplate,
  ): Promise<E.PromptTemplate> {
    return append(this.data.promptTemplates, promptTemplate);
  }

  async updatePromptTemplate(
    promptTemplate: E.PromptTemplate,
  ): Promise<E.PromptTemplate> {
    return replaceById(this.data.promptTemplates, promptTemplate);
  }

  async deletePromptTemplate(
    promptTemplateId: string,
  ): Promise<E.PromptTemplate | undefined> {
    return removeById(this.data.promptTemplates, promptTemplateId);
  }

  async listResourceFavorites(
    orgId: string,
    userId: string,
  ): Promise<E.ResourceFavorite[]> {
    return this.data.resourceFavorites.filter(
      (favorite) => favorite.orgId === orgId && favorite.userId === userId,
    );
  }

  async createResourceFavorite(
    favorite: E.ResourceFavorite,
  ): Promise<E.ResourceFavorite> {
    return append(this.data.resourceFavorites, favorite);
  }

  async deleteResourceFavorite(
    favoriteId: string,
  ): Promise<E.ResourceFavorite | undefined> {
    return removeById(this.data.resourceFavorites, favoriteId);
  }

  async listWorkspaceFolders(
    orgId: string,
    workspaceId?: string,
  ): Promise<E.WorkspaceFolder[]> {
    return this.data.workspaceFolders
      .filter(
        (folder) =>
          folder.orgId === orgId &&
          (workspaceId === undefined || folder.workspaceId === workspaceId),
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async listAuthorizedWorkspaceFoldersByIds(
    input: E.AuthorizedWorkspaceFoldersByIdsInput,
  ): Promise<E.WorkspaceFolder[]> {
    const folderIds = new Set(input.folderIds);
    return this.data.workspaceFolders
      .filter(
        (folder) =>
          folderIds.has(folder.id) &&
          folder.orgId === input.orgId &&
          folder.workspaceId === input.workspaceId &&
          (input.isAdmin ||
            folder.createdBy === input.principalId ||
            this.hasFolderReadGrant(input, folder.id)),
      )
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  async getWorkspaceFolder(
    folderId: string,
  ): Promise<E.WorkspaceFolder | undefined> {
    return this.data.workspaceFolders.find((folder) => folder.id === folderId);
  }

  async createWorkspaceFolder(
    folder: E.WorkspaceFolder,
  ): Promise<E.WorkspaceFolder> {
    return append(this.data.workspaceFolders, folder);
  }

  async updateWorkspaceFolder(
    folder: E.WorkspaceFolder,
  ): Promise<E.WorkspaceFolder> {
    return replaceById(this.data.workspaceFolders, folder);
  }

  async deleteWorkspaceFolder(
    folderId: string,
  ): Promise<E.WorkspaceFolder | undefined> {
    const deleted = removeById(this.data.workspaceFolders, folderId);
    if (deleted !== undefined) {
      this.data.workspaceFolderItems = this.data.workspaceFolderItems.filter(
        (item) => item.folderId !== folderId,
      );
    }
    return deleted;
  }

  async listWorkspaceFolderItems(
    folderId: string,
  ): Promise<E.WorkspaceFolderItem[]> {
    return this.data.workspaceFolderItems
      .filter((item) => item.folderId === folderId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async listAuthorizedWorkspaceFolderItemsBatch(
    input: E.AuthorizedWorkspaceFolderItemsBatchInput,
  ): Promise<E.WorkspaceFolderItemsBatchGroup[]> {
    const folderIds = [...new Set(input.folderIds)].sort();
    const allowedFolderIds = new Set(folderIds);
    const visibleItems = this.data.workspaceFolderItems
      .filter(
        (item) =>
          item.orgId === input.orgId &&
          item.workspaceId === input.workspaceId &&
          allowedFolderIds.has(item.folderId),
      )
      .filter((item) => this.canReadWorkspaceFolderItem(input, item))
      .sort(compareWorkspaceFolderItems);
    const itemsByFolderId = new Map<string, E.WorkspaceFolderItem[]>();
    for (const item of visibleItems) {
      const items = itemsByFolderId.get(item.folderId) ?? [];
      items.push(item);
      itemsByFolderId.set(item.folderId, items);
    }
    return folderIds.map((folderId) => {
      const items = itemsByFolderId.get(folderId) ?? [];
      return {
        folderId,
        hasMore: items.length > input.limitPerFolder,
        items: items.slice(0, input.limitPerFolder),
      };
    });
  }

  async createWorkspaceFolderItem(
    item: E.WorkspaceFolderItem,
  ): Promise<E.WorkspaceFolderItem> {
    const existing = this.data.workspaceFolderItems.find(
      (candidate) =>
        candidate.folderId === item.folderId &&
        candidate.resourceType === item.resourceType &&
        candidate.resourceId === item.resourceId,
    );
    return existing ?? append(this.data.workspaceFolderItems, item);
  }

  async deleteWorkspaceFolderItem(
    itemId: string,
  ): Promise<E.WorkspaceFolderItem | undefined> {
    return removeById(this.data.workspaceFolderItems, itemId);
  }

  private canReadWorkspaceFolderItem(
    input: E.AuthorizedWorkspaceFolderItemsBatchInput,
    item: E.WorkspaceFolderItem,
  ): boolean {
    if (item.resourceType === "agent") {
      const agent = this.data.agents.find(
        (candidate) =>
          candidate.id === item.resourceId &&
          candidate.orgId === input.orgId &&
          candidate.workspaceId === input.workspaceId &&
          candidate.archivedAt === undefined &&
          candidate.publishedVersionId !== undefined,
      );
      return (
        input.canReadAgents &&
        agent !== undefined &&
        this.hasFolderItemGrant(input, "agent", item.resourceId, [
          "read",
          "run",
        ])
      );
    }
    if (item.resourceType === "chat") {
      const chat = this.data.chats.find(
        (candidate) =>
          candidate.id === item.resourceId &&
          candidate.orgId === input.orgId &&
          candidate.workspaceId === input.workspaceId,
      );
      return (
        input.canReadChats &&
        chat !== undefined &&
        (input.isAdmin ||
          chat.createdBy === input.principalId ||
          this.hasFolderItemGrant(input, "chat", item.resourceId, [
            "read",
            "write",
          ]))
      );
    }
    const knowledgeBase = this.data.knowledgeBases.find(
      (candidate) =>
        candidate.id === item.resourceId &&
        candidate.orgId === input.orgId &&
        candidate.workspaceId === input.workspaceId,
    );
    return (
      input.canReadKnowledgeBases &&
      knowledgeBase !== undefined &&
      this.hasFolderItemGrant(input, "knowledge_base", item.resourceId, [
        "read",
      ])
    );
  }

  private hasFolderItemGrant(
    input: E.AuthorizedWorkspaceFolderItemsBatchInput,
    resourceType: E.WorkspaceFolderItem["resourceType"],
    resourceId: string,
    permissions: Array<"read" | "run" | "write">,
  ): boolean {
    if (input.isAdmin) return true;
    return this.data.grants.some(
      (grant) =>
        grant.resourceType === resourceType &&
        grant.resourceId === resourceId &&
        permissions.includes(
          grant.permission as (typeof permissions)[number],
        ) &&
        ((grant.principalType === input.principalType &&
          grant.principalId === input.principalId) ||
          (grant.principalType === "group" &&
            input.groupIds.includes(grant.principalId))),
    );
  }

  private hasFolderReadGrant(
    input: E.AuthorizedWorkspaceFoldersByIdsInput,
    folderId: string,
  ): boolean {
    return this.data.grants.some(
      (grant) =>
        grant.resourceType === "folder" &&
        grant.resourceId === folderId &&
        (grant.permission === "read" || grant.permission === "write") &&
        ((grant.principalType === input.principalType &&
          grant.principalId === input.principalId) ||
          (grant.principalType === "group" &&
            input.groupIds.includes(grant.principalId))),
    );
  }
}

function compareWorkspaceFolderItems(
  left: E.WorkspaceFolderItem,
  right: E.WorkspaceFolderItem,
): number {
  const folder = left.folderId.localeCompare(right.folderId);
  if (folder !== 0) return folder;
  const createdAt = left.createdAt.localeCompare(right.createdAt);
  return createdAt === 0 ? left.id.localeCompare(right.id) : createdAt;
}

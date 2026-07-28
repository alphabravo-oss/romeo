import type * as Auth from "@romeo/auth";
import type * as Ai from "@romeo/ai-runtime";

import type * as OAuth from "../domain/delegated-oauth";
import type * as E from "../domain/entities";
import type * as R from "../domain/repository";
import {
  append,
  appendMany,
  removeById,
  replaceById,
} from "./collection-helpers";
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
}

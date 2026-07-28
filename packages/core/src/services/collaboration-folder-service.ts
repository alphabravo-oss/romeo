import {
  AuthorizationError,
  assertScope,
  canAccessOrg,
  hasWorkspaceAccess,
  type AuthSubject,
  type ResourceGrant,
} from "@romeo/auth";

import type { WorkspaceFolder, WorkspaceFolderItem } from "../domain/entities";
import type { FolderItemResourceType } from "../domain/collaboration";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { getAuthorizedChat } from "./chat-access";
import { CollaborationFavoriteService } from "./collaboration-favorite-service";
import { canAccessFolder } from "./collaboration-folder-access";
import type { ShareInput } from "./collaboration-share-service";
import { getAuthorizedKnowledgeBase } from "./knowledge-access";
import { assertWorkspaceActive } from "./workspace-guard";

export class CollaborationFolderService extends CollaborationFavoriteService {
  async folders(
    subject: AuthSubject,
    workspaceId: string,
  ): Promise<WorkspaceFolder[]> {
    assertScope(subject, "me:read");
    if (!hasWorkspaceAccess(subject, workspaceId))
      throw new AuthorizationError(
        "The workspace is outside the caller access.",
      );
    const [folders, grants] = await Promise.all([
      this.repository.listWorkspaceFolders(subject.orgId, workspaceId),
      this.repository.listResourceGrants(subject.orgId),
    ]);
    return folders.filter((folder) =>
      canAccessFolder(subject, grants, folder, "read"),
    );
  }

  async createFolder(input: {
    subject: AuthSubject;
    workspaceId: string;
    name: string;
    data?: Record<string, unknown> | null | undefined;
    isExpanded?: boolean | undefined;
    meta?: Record<string, unknown> | null | undefined;
    parentId?: string | null | undefined;
  }): Promise<WorkspaceFolder> {
    assertScope(input.subject, "me:read");
    if (!hasWorkspaceAccess(input.subject, input.workspaceId))
      throw new AuthorizationError(
        "The workspace is outside the caller access.",
      );
    await assertWorkspaceActive(this.repository, {
      orgId: input.subject.orgId,
      workspaceId: input.workspaceId,
    });
    const grants = await this.repository.listResourceGrants(
      input.subject.orgId,
    );
    await this.assertValidFolderParent(
      input.subject,
      grants,
      {
        id: "",
        orgId: input.subject.orgId,
        workspaceId: input.workspaceId,
      },
      input.parentId ?? null,
    );
    await this.assertUniqueFolderName(input.subject, {
      workspaceId: input.workspaceId,
      name: input.name,
    });
    const now = new Date().toISOString();
    return this.repository.transaction(async (repository) => {
      const folder = await repository.createWorkspaceFolder({
        id: createId("folder"),
        orgId: input.subject.orgId,
        workspaceId: input.workspaceId,
        name: input.name.trim(),
        ...(input.parentId === undefined || input.parentId === null
          ? {}
          : { parentId: input.parentId }),
        ...(input.meta === undefined || input.meta === null
          ? {}
          : { meta: input.meta }),
        ...(input.data === undefined || input.data === null
          ? {}
          : { data: input.data }),
        isExpanded: input.isExpanded ?? false,
        createdBy: input.subject.id,
        createdAt: now,
        updatedAt: now,
      });
      await Promise.all(
        (["read", "write"] as const).map((permission) =>
          repository.createResourceGrant({
            id: createId("grant"),
            resourceType: "folder",
            resourceId: folder.id,
            principalType: input.subject.type,
            principalId: input.subject.id,
            permission,
          }),
        ),
      );
      await this.audit(
        input.subject,
        "folder.create",
        "folder",
        folder.id,
        {
          workspaceId: folder.workspaceId,
        },
        repository,
      );
      return folder;
    });
  }

  async folder(
    subject: AuthSubject,
    folderId: string,
  ): Promise<WorkspaceFolder> {
    return this.getAuthorizedFolder(subject, folderId, "read");
  }

  async updateFolder(input: {
    subject: AuthSubject;
    folderId: string;
    data?: Record<string, unknown> | null | undefined;
    isExpanded?: boolean | undefined;
    meta?: Record<string, unknown> | null | undefined;
    name?: string | undefined;
    parentId?: string | null | undefined;
  }): Promise<WorkspaceFolder> {
    const folder = await this.getAuthorizedFolder(
      input.subject,
      input.folderId,
      "write",
    );
    const nextName = input.name?.trim() ?? folder.name;
    if (nextName.length === 0) {
      throw new ApiError(
        "invalid_folder",
        "Folder name must not be empty.",
        400,
      );
    }
    if (nextName.toLowerCase() !== folder.name.toLowerCase()) {
      await this.assertUniqueFolderName(input.subject, {
        workspaceId: folder.workspaceId,
        name: nextName,
        excludeFolderId: folder.id,
      });
    }
    const grants = await this.repository.listResourceGrants(
      input.subject.orgId,
    );
    const parentId =
      input.parentId === undefined ? (folder.parentId ?? null) : input.parentId;
    await this.assertValidFolderParent(input.subject, grants, folder, parentId);
    const nextFolder: WorkspaceFolder = {
      ...folder,
      name: nextName,
      updatedAt: new Date().toISOString(),
    };
    if (parentId === null) delete nextFolder.parentId;
    else nextFolder.parentId = parentId;
    if (input.isExpanded !== undefined)
      nextFolder.isExpanded = input.isExpanded;
    if (input.meta !== undefined) {
      if (input.meta === null) delete nextFolder.meta;
      else nextFolder.meta = input.meta;
    }
    if (input.data !== undefined) {
      if (input.data === null) delete nextFolder.data;
      else nextFolder.data = input.data;
    }
    return this.repository.transaction(async (repository) => {
      const updated = await repository.updateWorkspaceFolder(nextFolder);
      await this.audit(
        input.subject,
        "folder.update",
        "folder",
        updated.id,
        {
          changedData: input.data !== undefined,
          changedExpanded: input.isExpanded !== undefined,
          changedMeta: input.meta !== undefined,
          changedName: input.name !== undefined,
          changedParent: input.parentId !== undefined,
          workspaceId: updated.workspaceId,
        },
        repository,
      );
      return updated;
    });
  }

  async deleteFolder(
    subject: AuthSubject,
    folderId: string,
  ): Promise<WorkspaceFolder> {
    const folder = await this.getAuthorizedFolder(subject, folderId, "write");
    const deleted = await this.repository.transaction(async (repository) => {
      const now = new Date().toISOString();
      const childFolders = (
        await repository.listWorkspaceFolders(subject.orgId, folder.workspaceId)
      ).filter((candidate) => candidate.parentId === folder.id);
      const itemCount = (await repository.listWorkspaceFolderItems(folder.id))
        .length;
      await Promise.all(
        childFolders.map((child) => {
          const orphanedChild: WorkspaceFolder = {
            ...child,
            updatedAt: now,
          };
          delete orphanedChild.parentId;
          return repository.updateWorkspaceFolder(orphanedChild);
        }),
      );
      const deletedFolder = await repository.deleteWorkspaceFolder(folder.id);
      if (deletedFolder !== undefined) {
        await this.audit(
          subject,
          "folder.delete",
          "folder",
          folder.id,
          {
            childFoldersReparented: childFolders.length,
            folderItemsRemoved: itemCount,
            workspaceId: folder.workspaceId,
          },
          repository,
        );
      }
      return {
        childCount: childFolders.length,
        deletedFolder,
        itemCount,
      };
    });
    if (deleted.deletedFolder === undefined) throw notFound("Folder");
    return deleted.deletedFolder;
  }

  async listFolderShares(
    subject: AuthSubject,
    folderId: string,
  ): Promise<ResourceGrant[]> {
    const folder = await this.getAuthorizedFolder(subject, folderId, "read");
    return this.sharesFor("folder", folder.id, subject.orgId);
  }

  async shareFolder(input: {
    subject: AuthSubject;
    folderId: string;
    share: ShareInput;
  }): Promise<ResourceGrant[]> {
    const folder = await this.getAuthorizedFolder(
      input.subject,
      input.folderId,
      "write",
    );
    return this.repository.transaction(async (repository) => {
      const grants = await this.shareResource({
        repository,
        subject: input.subject,
        resourceType: "folder",
        resourceId: folder.id,
        allowedPermissions: ["read", "write"],
        share: input.share,
      });
      await this.audit(
        input.subject,
        "folder.share",
        "folder",
        folder.id,
        {
          principalType: input.share.principalType,
          permissions: grants.map((grant) => grant.permission),
        },
        repository,
      );
      return grants;
    });
  }

  async folderItems(
    subject: AuthSubject,
    folderId: string,
  ): Promise<WorkspaceFolderItem[]> {
    const folder = await this.getAuthorizedFolder(subject, folderId, "read");
    const items = await this.repository.listWorkspaceFolderItems(folder.id);
    const visible = await Promise.all(
      items.map(async (item) =>
        (await this.canReadFolderItem(subject, item)) ? item : undefined,
      ),
    );
    return visible.filter(
      (item): item is WorkspaceFolderItem => item !== undefined,
    );
  }

  async addFolderItem(input: {
    subject: AuthSubject;
    folderId: string;
    resourceType: FolderItemResourceType;
    resourceId: string;
  }): Promise<WorkspaceFolderItem> {
    const folder = await this.getAuthorizedFolder(
      input.subject,
      input.folderId,
      "write",
    );
    if (
      !(await this.canReadFolderItem(input.subject, {
        resourceType: input.resourceType,
        resourceId: input.resourceId,
      }))
    ) {
      throw notFound("Folder item resource");
    }
    return this.repository.transaction(async (repository) => {
      const item = await repository.createWorkspaceFolderItem({
        id: createId("folder_item"),
        orgId: folder.orgId,
        workspaceId: folder.workspaceId,
        folderId: folder.id,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        createdAt: new Date().toISOString(),
      });
      await this.audit(
        input.subject,
        "folder.item.add",
        "folder",
        folder.id,
        {
          resourceType: item.resourceType,
          resourceId: item.resourceId,
        },
        repository,
      );
      return item;
    });
  }

  async deleteFolderItem(
    subject: AuthSubject,
    folderId: string,
    itemId: string,
  ): Promise<WorkspaceFolderItem> {
    const folder = await this.getAuthorizedFolder(subject, folderId, "write");
    const item = (
      await this.repository.listWorkspaceFolderItems(folder.id)
    ).find((candidate) => candidate.id === itemId);
    if (!item) throw notFound("Folder item");
    return this.repository.transaction(async (repository) => {
      const deleted = await repository.deleteWorkspaceFolderItem(itemId);
      if (!deleted) throw notFound("Folder item");
      await this.audit(
        subject,
        "folder.item.delete",
        "folder",
        folder.id,
        {
          resourceType: deleted.resourceType,
          resourceId: deleted.resourceId,
        },
        repository,
      );
      return deleted;
    });
  }

  protected async getAuthorizedFolder(
    subject: AuthSubject,
    folderId: string,
    permission: "read" | "write",
  ): Promise<WorkspaceFolder> {
    assertScope(subject, "me:read");
    const folder = await this.repository.getWorkspaceFolder(folderId);
    if (!folder) throw notFound("Folder");
    if (!canAccessOrg(subject, folder.orgId)) throw notFound("Folder");
    if (!hasWorkspaceAccess(subject, folder.workspaceId))
      throw new AuthorizationError(
        "The folder is outside the caller workspace access.",
      );
    const grants = await this.repository.listResourceGrants(subject.orgId);
    if (!canAccessFolder(subject, grants, folder, permission))
      throw new AuthorizationError(
        `Missing ${permission} permission for folder:${folder.id}`,
      );
    return folder;
  }

  protected async assertUniqueFolderName(
    subject: AuthSubject,
    input: {
      workspaceId: string;
      name: string;
      excludeFolderId?: string | undefined;
    },
  ): Promise<void> {
    const normalized = input.name.trim().toLowerCase();
    const duplicate = (
      await this.repository.listWorkspaceFolders(
        subject.orgId,
        input.workspaceId,
      )
    ).find(
      (folder) =>
        folder.id !== input.excludeFolderId &&
        folder.name.toLowerCase() === normalized,
    );
    if (duplicate !== undefined) {
      throw new ApiError("folder_exists", "Folder already exists.", 400);
    }
  }

  protected async assertValidFolderParent(
    subject: AuthSubject,
    grants: ResourceGrant[],
    folder: Pick<WorkspaceFolder, "id" | "orgId" | "workspaceId">,
    parentId: string | null,
  ): Promise<void> {
    if (parentId === null) return;
    if (parentId === folder.id) {
      throw new ApiError(
        "invalid_folder_parent",
        "A folder cannot be its own parent.",
        400,
      );
    }
    const parent = await this.repository.getWorkspaceFolder(parentId);
    if (
      parent === undefined ||
      parent.orgId !== folder.orgId ||
      parent.workspaceId !== folder.workspaceId ||
      !canAccessFolder(subject, grants, parent, "read")
    ) {
      throw notFound("Folder");
    }
    const folders = await this.repository.listWorkspaceFolders(
      folder.orgId,
      folder.workspaceId,
    );
    const byId = new Map(folders.map((candidate) => [candidate.id, candidate]));
    let cursor: WorkspaceFolder | undefined = parent;
    const seen = new Set<string>();
    while (cursor !== undefined) {
      if (cursor.id === folder.id || seen.has(cursor.id)) {
        throw new ApiError(
          "invalid_folder_parent",
          "A folder cannot be moved under one of its descendants.",
          400,
        );
      }
      if (cursor.parentId === undefined) break;
      seen.add(cursor.id);
      cursor = byId.get(cursor.parentId);
    }
  }

  protected async canReadFolderItem(
    subject: AuthSubject,
    item: Pick<WorkspaceFolderItem, "resourceId" | "resourceType">,
  ): Promise<boolean> {
    try {
      if (item.resourceType === "agent") {
        await this.assertCanFavorite(subject, "agent", item.resourceId);
        return true;
      }
      if (item.resourceType === "chat") {
        await getAuthorizedChat(this.repository, {
          chatId: item.resourceId,
          subject,
          scope: "chats:read",
          permission: "read",
        });
        return true;
      }
      await getAuthorizedKnowledgeBase(this.repository, {
        knowledgeBaseId: item.resourceId,
        subject,
        scope: "knowledge:read",
        permission: "read",
      });
      return true;
    } catch {
      return false;
    }
  }
}

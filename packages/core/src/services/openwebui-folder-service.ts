import { assertScope, type AuthSubject, type ResourceGrant } from "@romeo/auth";
import type {
  OpenWebUiChatResponse,
  OpenWebUiChatTitleIdResponse,
  OpenWebUiCreateFolderInput,
  OpenWebUiFolderListItemResponse,
  OpenWebUiFolderResponse,
  OpenWebUiUpdateChatFolderInput,
  OpenWebUiUpdateFolderInput,
} from "@romeo/contracts";

import type { WorkspaceFolder } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { getAuthorizedChat } from "./chat-access";
import {
  canAccessFolder,
  toFolderListItem,
  toFolderResponse,
} from "./openwebui-chat-helpers";
import type { OpenWebUiChatSupport } from "./openwebui-chat-support";
import { paginate } from "./openwebui-compatibility-values";
import { assertWorkspaceActive } from "./workspace-guard";

export class OpenWebUiFolderService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly chats: OpenWebUiChatSupport,
  ) {}

  async chatsByFolder(
    subject: AuthSubject,
    folderId: string,
    options: { compact?: boolean; page?: number | null } = {},
  ): Promise<OpenWebUiChatResponse[] | OpenWebUiChatTitleIdResponse[]> {
    assertScope(subject, "chats:read");
    const folder = await this.repository.getWorkspaceFolder(folderId);
    const grants = await this.repository.listResourceGrants(subject.orgId);
    if (
      folder === undefined ||
      !canAccessFolder(subject, grants, folder, "read")
    ) {
      throw notFound("Folder");
    }
    const items = await this.repository.listWorkspaceFolderItems(folder.id);
    const chatIds = new Set(
      items
        .filter((item) => item.resourceType === "chat")
        .map((item) => item.resourceId),
    );
    const visibleChats = await this.chats.visibleChats(subject, {
      archived: false,
    });
    const folderChats = visibleChats
      .filter((chat) => chatIds.has(chat.id))
      .filter((chat) => chat.workspaceId === folder.workspaceId);
    const page = paginate(folderChats, options.page, options.compact ? 10 : 60);
    if (options.compact === true) {
      return page.map((chat) => this.chats.toChatTitle(chat));
    }
    return Promise.all(
      page.map((chat) =>
        this.chats.toChatResponse(this.repository, subject, chat, folder.id),
      ),
    );
  }

  async updateChatFolder(
    subject: AuthSubject,
    chatId: string,
    input: OpenWebUiUpdateChatFolderInput,
  ): Promise<OpenWebUiChatResponse> {
    const chat = await getAuthorizedChat(this.repository, {
      chatId,
      subject,
      scope: "chats:write",
      permission: "write",
    });
    const folderId = input.folder_id ?? null;
    const grants = await this.repository.listResourceGrants(subject.orgId);
    const destination =
      folderId === null
        ? undefined
        : await this.repository.getWorkspaceFolder(folderId);
    if (
      folderId !== null &&
      (destination === undefined ||
        destination.orgId !== chat.orgId ||
        destination.workspaceId !== chat.workspaceId ||
        !canAccessFolder(subject, grants, destination, "write"))
    ) {
      throw notFound("Folder");
    }
    return this.repository.transaction(async (repository) => {
      const folders = await repository.listWorkspaceFolders(
        subject.orgId,
        chat.workspaceId,
      );
      const txGrants = await repository.listResourceGrants(subject.orgId);
      await Promise.all(
        folders
          .filter((folder) =>
            canAccessFolder(subject, txGrants, folder, "write"),
          )
          .map(async (folder) => {
            const items = await repository.listWorkspaceFolderItems(folder.id);
            await Promise.all(
              items
                .filter(
                  (item) =>
                    item.resourceType === "chat" && item.resourceId === chat.id,
                )
                .map((item) => repository.deleteWorkspaceFolderItem(item.id)),
            );
          }),
      );
      if (destination !== undefined) {
        await repository.createWorkspaceFolderItem({
          id: createId("folder_item"),
          orgId: subject.orgId,
          workspaceId: chat.workspaceId,
          folderId: destination.id,
          resourceType: "chat",
          resourceId: chat.id,
          createdAt: new Date().toISOString(),
        });
      }
      return this.chats.toChatResponse(repository, subject, chat, folderId);
    });
  }

  async list(subject: AuthSubject): Promise<OpenWebUiFolderListItemResponse[]> {
    assertScope(subject, "me:read");
    const grants = await this.repository.listResourceGrants(subject.orgId);
    const folders = (
      await Promise.all(
        subject.workspaceIds.map((workspaceId) =>
          this.repository.listWorkspaceFolders(subject.orgId, workspaceId),
        ),
      )
    )
      .flat()
      .filter((folder) => canAccessFolder(subject, grants, folder, "read"));
    return folders.map(toFolderListItem);
  }

  async get(
    subject: AuthSubject,
    folderId: string,
  ): Promise<OpenWebUiFolderResponse> {
    assertScope(subject, "me:read");
    return toFolderResponse(
      await this.getAuthorizedFolder(subject, folderId, "read"),
      subject.id,
    );
  }

  async create(
    subject: AuthSubject,
    input: OpenWebUiCreateFolderInput,
  ): Promise<OpenWebUiFolderResponse> {
    assertScope(subject, "me:read");
    const workspaceId = this.chats.defaultWorkspaceId(subject);
    await assertWorkspaceActive(this.repository, {
      orgId: subject.orgId,
      workspaceId,
    });
    const grants = await this.repository.listResourceGrants(subject.orgId);
    await this.assertValidParent(
      subject,
      grants,
      { id: "", orgId: subject.orgId, workspaceId },
      input.parent_id ?? null,
    );
    const existing = (
      await this.repository.listWorkspaceFolders(subject.orgId, workspaceId)
    ).find(
      (folder) => folder.name.toLowerCase() === input.name.trim().toLowerCase(),
    );
    if (existing !== undefined) {
      throw new ApiError(
        "openwebui_folder_exists",
        "Folder already exists.",
        400,
      );
    }
    const now = new Date().toISOString();
    const folder = await this.repository.createWorkspaceFolder({
      id: createId("folder"),
      orgId: subject.orgId,
      workspaceId,
      name: input.name.trim(),
      ...(input.parent_id === undefined || input.parent_id === null
        ? {}
        : { parentId: input.parent_id }),
      ...(input.meta === undefined || input.meta === null
        ? {}
        : { meta: input.meta }),
      ...(input.data === undefined || input.data === null
        ? {}
        : { data: input.data }),
      isExpanded: false,
      createdBy: subject.id,
      createdAt: now,
      updatedAt: now,
    });
    await Promise.all(
      (["read", "write"] as const).map((permission) =>
        this.repository.createResourceGrant({
          id: createId("grant"),
          resourceType: "folder",
          resourceId: folder.id,
          principalType: subject.type,
          principalId: subject.id,
          permission,
        }),
      ),
    );
    return toFolderResponse(folder, subject.id);
  }

  async update(
    subject: AuthSubject,
    folderId: string,
    input: OpenWebUiUpdateFolderInput,
  ): Promise<OpenWebUiFolderResponse> {
    assertScope(subject, "me:read");
    const folder = await this.getAuthorizedFolder(subject, folderId, "write");
    const name = input.name?.trim();
    if (name !== undefined && name.length === 0) {
      throw new ApiError(
        "invalid_openwebui_folder",
        "Folder name must not be empty.",
        400,
      );
    }
    const nextName = name ?? folder.name;
    if (nextName.toLowerCase() !== folder.name.toLowerCase()) {
      const duplicate = (
        await this.repository.listWorkspaceFolders(
          subject.orgId,
          folder.workspaceId,
        )
      ).find(
        (candidate) =>
          candidate.id !== folder.id &&
          candidate.name.toLowerCase() === nextName.toLowerCase(),
      );
      if (duplicate !== undefined) {
        throw new ApiError(
          "openwebui_folder_exists",
          "Folder already exists.",
          400,
        );
      }
    }
    const grants = await this.repository.listResourceGrants(subject.orgId);
    const parentId =
      input.parent_id === undefined
        ? (folder.parentId ?? null)
        : input.parent_id;
    await this.assertValidParent(subject, grants, folder, parentId);
    const nextFolder: WorkspaceFolder = {
      ...folder,
      name: nextName,
      isExpanded: folder.isExpanded ?? false,
      updatedAt: new Date().toISOString(),
    };
    if (parentId === null) delete nextFolder.parentId;
    else nextFolder.parentId = parentId;
    if (input.meta !== undefined) {
      if (input.meta === null) delete nextFolder.meta;
      else nextFolder.meta = input.meta;
    }
    if (input.data !== undefined) {
      if (input.data === null) delete nextFolder.data;
      else nextFolder.data = input.data;
    }
    return toFolderResponse(
      await this.repository.updateWorkspaceFolder(nextFolder),
      subject.id,
    );
  }

  async updateExpanded(
    subject: AuthSubject,
    folderId: string,
    isExpanded: boolean,
  ): Promise<OpenWebUiFolderResponse> {
    assertScope(subject, "me:read");
    const folder = await this.getAuthorizedFolder(subject, folderId, "write");
    const updated = await this.repository.updateWorkspaceFolder({
      ...folder,
      isExpanded,
      updatedAt: new Date().toISOString(),
    });
    return toFolderResponse(updated, subject.id);
  }

  async updateParent(
    subject: AuthSubject,
    folderId: string,
    parentId: string | null,
  ): Promise<OpenWebUiFolderResponse> {
    assertScope(subject, "me:read");
    const folder = await this.getAuthorizedFolder(subject, folderId, "write");
    const grants = await this.repository.listResourceGrants(subject.orgId);
    await this.assertValidParent(subject, grants, folder, parentId);
    const nextFolder: WorkspaceFolder = {
      ...folder,
      updatedAt: new Date().toISOString(),
    };
    if (parentId === null) delete nextFolder.parentId;
    else nextFolder.parentId = parentId;
    return toFolderResponse(
      await this.repository.updateWorkspaceFolder(nextFolder),
      subject.id,
    );
  }

  async delete(
    subject: AuthSubject,
    folderId: string,
  ): Promise<OpenWebUiFolderResponse> {
    assertScope(subject, "me:read");
    const folder = await this.getAuthorizedFolder(subject, folderId, "write");
    const deleted = await this.repository.transaction(async (repository) => {
      const childFolders = (
        await repository.listWorkspaceFolders(subject.orgId, folder.workspaceId)
      ).filter((candidate) => candidate.parentId === folder.id);
      await Promise.all(
        childFolders.map((child) => {
          const orphanedChild: WorkspaceFolder = {
            ...child,
            updatedAt: new Date().toISOString(),
          };
          delete orphanedChild.parentId;
          return repository.updateWorkspaceFolder(orphanedChild);
        }),
      );
      return repository.deleteWorkspaceFolder(folder.id);
    });
    if (deleted === undefined) throw notFound("Folder");
    return toFolderResponse(deleted, subject.id);
  }

  private async getAuthorizedFolder(
    subject: AuthSubject,
    folderId: string,
    permission: "read" | "write",
  ): Promise<WorkspaceFolder> {
    const [folder, grants] = await Promise.all([
      this.repository.getWorkspaceFolder(folderId),
      this.repository.listResourceGrants(subject.orgId),
    ]);
    if (
      folder === undefined ||
      !canAccessFolder(subject, grants, folder, permission)
    ) {
      throw notFound("Folder");
    }
    return folder;
  }

  private async assertValidParent(
    subject: AuthSubject,
    grants: ResourceGrant[],
    folder: Pick<WorkspaceFolder, "id" | "orgId" | "workspaceId">,
    parentId: string | null,
  ): Promise<void> {
    if (parentId === null) return;
    if (parentId === folder.id) {
      throw new ApiError(
        "invalid_openwebui_folder_parent",
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
          "invalid_openwebui_folder_parent",
          "A folder cannot be moved under one of its descendants.",
          400,
        );
      }
      if (cursor.parentId === undefined) break;
      seen.add(cursor.id);
      cursor = byId.get(cursor.parentId);
    }
  }
}

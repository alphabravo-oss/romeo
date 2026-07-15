import {
  AuthorizationError,
  assertScope,
  canAccessOrg,
  hasGrant,
  hasWorkspaceAccess,
  type AuthSubject,
  type ResourceGrant,
} from "@romeo/auth";

import type {
  Agent,
  FileObject,
  KnowledgeBase,
  ResourceFavorite,
  WorkspaceFolder,
  WorkspaceFolderItem,
} from "../domain/entities";
import type {
  FavoritableResourceType,
  FolderItemResourceType,
} from "../domain/collaboration";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { getAuthorizedAgent } from "./agent-access";
import { writeAuditLog } from "./audit-log";
import { getAuthorizedChat } from "./chat-access";
import { getAuthorizedKnowledgeBase } from "./knowledge-access";
import { filterVisibleServiceAccounts } from "./service-account-access";
import { assertWorkspaceActive } from "./workspace-guard";

export interface ShareInput {
  principalType: ResourceGrant["principalType"];
  principalId: string;
  permissions: ResourceGrant["permission"][];
}

export interface AgentGalleryItem extends Agent {
  favorite: boolean;
}

export interface ShareTarget {
  principalType: ShareInput["principalType"];
  principalId: string;
  label: string;
  detail?: string;
}

export class CollaborationService {
  constructor(private readonly repository: RomeoRepository) {}

  async shareTargets(
    subject: AuthSubject,
    query = "",
    limit = 20,
  ): Promise<ShareTarget[]> {
    assertScope(subject, "me:read");
    const normalizedQuery = query.trim().toLowerCase();
    const boundedLimit =
      Number.isInteger(limit) && limit > 0 && limit <= 50 ? limit : 20;
    const [users, grants, serviceAccounts, groups] = await Promise.all([
      this.repository.listUsers(subject.orgId),
      this.repository.listResourceGrants(subject.orgId),
      this.repository.listServiceAccounts(subject.orgId),
      this.repository.listGroups(subject.orgId),
    ]);
    const groupIds = new Set<string>(subject.groupIds);
    for (const grant of grants) {
      if (grant.principalType === "group") groupIds.add(grant.principalId);
    }
    const durableGroupIds = new Set(groups.map((group) => group.id));
    const targets: ShareTarget[] = [
      ...users.map((user) => ({
        principalType: "user" as const,
        principalId: user.id,
        label: user.name,
        detail: user.email,
      })),
      ...groups.map((group) => ({
        principalType: "group" as const,
        principalId: group.id,
        label: group.name,
      })),
      ...[...groupIds]
        .filter((groupId) => !durableGroupIds.has(groupId))
        .sort()
        .map((groupId) => ({
          principalType: "group" as const,
          principalId: groupId,
          label: groupLabel(groupId),
        })),
      ...filterVisibleServiceAccounts(subject, serviceAccounts).map(
        (account) => ({
          principalType: "service_account" as const,
          principalId: account.id,
          label: account.name,
          ...(account.disabledAt === undefined ? {} : { detail: "disabled" }),
        }),
      ),
    ];

    return targets
      .filter((target) => targetMatches(target, normalizedQuery))
      .sort(
        (left, right) =>
          principalOrder(left.principalType) -
            principalOrder(right.principalType) ||
          left.label.localeCompare(right.label) ||
          left.principalId.localeCompare(right.principalId),
      )
      .slice(0, boundedLimit);
  }

  async listAgentShares(
    subject: AuthSubject,
    agentId: string,
  ): Promise<ResourceGrant[]> {
    const agent = await getAuthorizedAgent(this.repository, {
      agentId,
      subject,
      scope: "agents:read",
    });
    return this.sharesFor("agent", agent.id, subject.orgId);
  }

  async shareAgent(input: {
    subject: AuthSubject;
    agentId: string;
    share: ShareInput;
  }): Promise<ResourceGrant[]> {
    const agent = await getAuthorizedAgent(this.repository, {
      agentId: input.agentId,
      subject: input.subject,
      scope: "agents:write",
    });
    return this.repository.transaction(async (repository) => {
      const grants = await this.shareResource({
        repository,
        subject: input.subject,
        resourceType: "agent",
        resourceId: agent.id,
        allowedPermissions: ["read", "run", "write"],
        share: input.share,
      });
      await this.audit(
        input.subject,
        "agent.share",
        "agent",
        agent.id,
        {
          principalType: input.share.principalType,
          permissions: grants.map((grant) => grant.permission),
        },
        repository,
      );
      return grants;
    });
  }

  async listKnowledgeBaseShares(
    subject: AuthSubject,
    knowledgeBaseId: string,
  ): Promise<ResourceGrant[]> {
    const knowledgeBase = await getAuthorizedKnowledgeBase(this.repository, {
      knowledgeBaseId,
      subject,
      scope: "knowledge:read",
      permission: "read",
    });
    return this.sharesFor("knowledge_base", knowledgeBase.id, subject.orgId);
  }

  async shareKnowledgeBase(input: {
    subject: AuthSubject;
    knowledgeBaseId: string;
    share: ShareInput;
  }): Promise<ResourceGrant[]> {
    const knowledgeBase = await getAuthorizedKnowledgeBase(this.repository, {
      knowledgeBaseId: input.knowledgeBaseId,
      subject: input.subject,
      scope: "knowledge:write",
      permission: "write",
    });
    return this.repository.transaction(async (repository) => {
      const grants = await this.shareResource({
        repository,
        subject: input.subject,
        resourceType: "knowledge_base",
        resourceId: knowledgeBase.id,
        allowedPermissions: ["read", "use", "write"],
        share: input.share,
      });
      await this.audit(
        input.subject,
        "knowledge_base.share",
        "knowledge_base",
        knowledgeBase.id,
        {
          principalType: input.share.principalType,
          permissions: grants.map((grant) => grant.permission),
        },
        repository,
      );
      return grants;
    });
  }

  async listChatShares(
    subject: AuthSubject,
    chatId: string,
  ): Promise<ResourceGrant[]> {
    const chat = await getAuthorizedChat(this.repository, {
      chatId,
      subject,
      scope: "chats:read",
      permission: "read",
    });
    return this.sharesFor("chat", chat.id, subject.orgId);
  }

  async shareChat(input: {
    subject: AuthSubject;
    chatId: string;
    share: ShareInput;
  }): Promise<ResourceGrant[]> {
    const chat = await getAuthorizedChat(this.repository, {
      chatId: input.chatId,
      subject: input.subject,
      scope: "chats:write",
      permission: "write",
    });
    return this.repository.transaction(async (repository) => {
      const grants = await this.shareResource({
        repository,
        subject: input.subject,
        resourceType: "chat",
        resourceId: chat.id,
        allowedPermissions: ["read", "write"],
        share: input.share,
      });
      await this.audit(
        input.subject,
        "chat.share",
        "chat",
        chat.id,
        {
          principalType: input.share.principalType,
          permissions: grants.map((grant) => grant.permission),
        },
        repository,
      );
      return grants;
    });
  }

  async listFileShares(
    subject: AuthSubject,
    fileId: string,
  ): Promise<ResourceGrant[]> {
    const file = await this.getAuthorizedFile(subject, fileId, "read");
    return this.sharesFor("file", file.id, subject.orgId);
  }

  async shareFile(input: {
    subject: AuthSubject;
    fileId: string;
    share: ShareInput;
  }): Promise<ResourceGrant[]> {
    const file = await this.getAuthorizedFile(
      input.subject,
      input.fileId,
      "write",
    );
    return this.repository.transaction(async (repository) => {
      const grants = await this.shareResource({
        repository,
        subject: input.subject,
        resourceType: "file",
        resourceId: file.id,
        allowedPermissions: ["read", "write"],
        share: input.share,
      });
      await this.audit(
        input.subject,
        "file.share",
        "file",
        file.id,
        {
          principalType: input.share.principalType,
          permissions: grants.map((grant) => grant.permission),
        },
        repository,
      );
      return grants;
    });
  }

  async agentGallery(
    subject: AuthSubject,
    workspaceId?: string,
  ): Promise<AgentGalleryItem[]> {
    assertScope(subject, "agents:read");
    const targetWorkspaceId = workspaceId ?? subject.workspaceIds[0];
    if (targetWorkspaceId === undefined) return [];
    if (!hasWorkspaceAccess(subject, targetWorkspaceId))
      throw new AuthorizationError(
        "The workspace is outside the caller access.",
      );

    const [agents, grants, favorites] = await Promise.all([
      this.repository.listAgents(targetWorkspaceId),
      this.repository.listResourceGrants(subject.orgId),
      this.repository.listResourceFavorites(subject.orgId, subject.id),
    ]);
    const favoriteIds = new Set(
      favorites
        .filter((favorite) => favorite.resourceType === "agent")
        .map((favorite) => favorite.resourceId),
    );
    return agents
      .filter((agent) => agent.publishedVersionId !== undefined)
      .filter((agent) => canAccessOrg(subject, agent.orgId))
      .filter(
        (agent) =>
          hasGrant(subject, grants, "agent", agent.id, "run") ||
          hasGrant(subject, grants, "agent", agent.id, "read"),
      )
      .map((agent) => ({ ...agent, favorite: favoriteIds.has(agent.id) }));
  }

  async favorites(subject: AuthSubject): Promise<ResourceFavorite[]> {
    assertScope(subject, "me:read");
    return this.repository.listResourceFavorites(subject.orgId, subject.id);
  }

  async favorite(input: {
    subject: AuthSubject;
    resourceType: FavoritableResourceType;
    resourceId: string;
  }): Promise<ResourceFavorite> {
    assertScope(input.subject, "me:read");
    await this.assertCanFavorite(
      input.subject,
      input.resourceType,
      input.resourceId,
    );
    const existing = (
      await this.repository.listResourceFavorites(
        input.subject.orgId,
        input.subject.id,
      )
    ).find(
      (favorite) =>
        favorite.resourceType === input.resourceType &&
        favorite.resourceId === input.resourceId,
    );
    if (existing) return existing;

    return this.repository.transaction(async (repository) => {
      const favorite = await repository.createResourceFavorite({
        id: createId("favorite"),
        orgId: input.subject.orgId,
        userId: input.subject.id,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        createdAt: new Date().toISOString(),
      });
      await this.audit(
        input.subject,
        "resource.favorite",
        favorite.resourceType,
        favorite.resourceId,
        {},
        repository,
      );
      return favorite;
    });
  }

  async deleteFavorite(
    subject: AuthSubject,
    favoriteId: string,
  ): Promise<ResourceFavorite> {
    assertScope(subject, "me:read");
    const favorite = (
      await this.repository.listResourceFavorites(subject.orgId, subject.id)
    ).find((item) => item.id === favoriteId);
    if (!favorite) throw notFound("Favorite");
    const deleted = await this.repository.deleteResourceFavorite(favoriteId);
    if (!deleted) throw notFound("Favorite");
    return deleted;
  }

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

  private async shareResource(input: {
    repository?: RomeoRepository;
    subject: AuthSubject;
    resourceType: ResourceGrant["resourceType"];
    resourceId: string;
    allowedPermissions: ResourceGrant["permission"][];
    share: ShareInput;
  }): Promise<ResourceGrant[]> {
    validatePrincipal(input.share);
    const invalid = input.share.permissions.filter(
      (permission) => !input.allowedPermissions.includes(permission),
    );
    if (invalid.length > 0)
      throw new ApiError(
        "invalid_share_permission",
        "Share includes an unsupported permission.",
        400,
        { permissions: invalid },
      );

    const repository = input.repository ?? this.repository;
    const existing = await this.sharesFor(
      input.resourceType,
      input.resourceId,
      input.subject.orgId,
      repository,
    );
    const created: ResourceGrant[] = [];
    for (const permission of [...new Set(input.share.permissions)]) {
      const grant = existing.find(
        (item) =>
          item.principalType === input.share.principalType &&
          item.principalId === input.share.principalId &&
          item.permission === permission,
      );
      if (grant) {
        created.push(grant);
        continue;
      }

      created.push(
        await repository.createResourceGrant({
          id: createId("grant"),
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          principalType: input.share.principalType,
          principalId: input.share.principalId,
          permission,
        }),
      );
    }
    return created;
  }

  private async sharesFor(
    resourceType: ResourceGrant["resourceType"],
    resourceId: string,
    orgId: string,
    repository: RomeoRepository = this.repository,
  ): Promise<ResourceGrant[]> {
    return (await repository.listResourceGrants(orgId)).filter(
      (grant) =>
        grant.resourceType === resourceType && grant.resourceId === resourceId,
    );
  }

  private async getAuthorizedFile(
    subject: AuthSubject,
    fileId: string,
    permission: "read" | "write",
  ): Promise<FileObject> {
    assertScope(subject, permission === "read" ? "files:read" : "files:write");
    const file = await this.repository.getFileObject(fileId);
    if (
      file === undefined ||
      file.orgId !== subject.orgId ||
      file.status === "deleted"
    ) {
      throw notFound("File");
    }
    if (!hasWorkspaceAccess(subject, file.workspaceId)) {
      throw new AuthorizationError(
        "The file workspace is outside the caller access.",
      );
    }
    const grants = await this.repository.listResourceGrants(subject.orgId);
    if (
      subject.isAdmin !== true &&
      !(file.ownerType === subject.type && file.ownerId === subject.id) &&
      !hasGrant(subject, grants, "file", file.id, permission)
    ) {
      throw new AuthorizationError(
        `Missing ${permission} permission for file:${file.id}`,
      );
    }
    return file;
  }

  private async assertCanFavorite(
    subject: AuthSubject,
    resourceType: FavoritableResourceType,
    resourceId: string,
  ): Promise<void> {
    const grants = await this.repository.listResourceGrants(subject.orgId);
    if (resourceType === "agent") {
      const agent = await getAuthorizedAgent(this.repository, {
        agentId: resourceId,
        subject,
        scope: "agents:read",
      });
      if (
        !hasGrant(subject, grants, "agent", agent.id, "run") &&
        !hasGrant(subject, grants, "agent", agent.id, "read")
      ) {
        throw new AuthorizationError("Missing access to favorite this agent.");
      }
      return;
    }
    if (resourceType === "chat") {
      await getAuthorizedChat(this.repository, {
        chatId: resourceId,
        subject,
        scope: "chats:read",
        permission: "read",
      });
      return;
    }

    await getAuthorizedKnowledgeBase(this.repository, {
      knowledgeBaseId: resourceId,
      subject,
      scope: "knowledge:read",
      permission: "read",
    });
  }

  private async getAuthorizedFolder(
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

  private async assertUniqueFolderName(
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

  private async assertValidFolderParent(
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

  private async canReadFolderItem(
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

  private async audit(
    subject: AuthSubject,
    action: string,
    resourceType: string,
    resourceId: string,
    metadata: Record<string, unknown>,
    repository: RomeoRepository = this.repository,
  ): Promise<void> {
    await writeAuditLog(repository, {
      subject,
      action,
      resourceType,
      resourceId,
      metadata,
    });
  }
}

function canAccessFolder(
  subject: AuthSubject,
  grants: ResourceGrant[],
  folder: WorkspaceFolder,
  permission: "read" | "write",
): boolean {
  if (!canAccessOrg(subject, folder.orgId)) return false;
  if (!hasWorkspaceAccess(subject, folder.workspaceId)) return false;
  if (subject.isAdmin === true || folder.createdBy === subject.id) return true;
  if (
    permission === "read" &&
    hasGrant(subject, grants, "folder", folder.id, "read")
  )
    return true;
  return hasGrant(subject, grants, "folder", folder.id, "write");
}

function validatePrincipal(share: ShareInput): void {
  if (!["group", "service_account", "user"].includes(share.principalType)) {
    throw new ApiError(
      "invalid_principal",
      "Share principal type is not supported.",
      400,
    );
  }
  if (share.principalId.trim().length === 0)
    throw new ApiError(
      "invalid_principal",
      "Share principal ID is required.",
      400,
    );
  if (share.permissions.length === 0)
    throw new ApiError(
      "invalid_share_permission",
      "Share requires at least one permission.",
      400,
    );
}

function targetMatches(target: ShareTarget, query: string): boolean {
  if (query.length === 0) return true;
  return (
    target.principalId.toLowerCase().includes(query) ||
    target.label.toLowerCase().includes(query) ||
    target.detail?.toLowerCase().includes(query) === true
  );
}

function groupLabel(groupId: string): string {
  return (
    groupId
      .replace(/^group_/u, "")
      .split(/[_-]+/u)
      .filter((part) => part.length > 0)
      .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
      .join(" ") || groupId
  );
}

function principalOrder(type: ShareTarget["principalType"]): number {
  if (type === "user") return 0;
  if (type === "group") return 1;
  return 2;
}

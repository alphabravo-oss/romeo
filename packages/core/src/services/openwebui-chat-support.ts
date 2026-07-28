import { AuthorizationError, type AuthSubject } from "@romeo/auth";
import type {
  OpenWebUiChatResponse,
  OpenWebUiChatTitleIdResponse,
} from "@romeo/contracts";

import type { Chat, ResourceFavorite } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { canReadChat } from "./chat-access";
import {
  canAccessFolder,
  toOpenWebUiChatDocument,
} from "./openwebui-chat-helpers";
import { toEpochSeconds } from "./openwebui-compatibility-values";

export class OpenWebUiChatSupport {
  constructor(private readonly repository: RomeoRepository) {}

  async visibleChats(
    subject: AuthSubject,
    options: { archived: boolean },
  ): Promise<Chat[]> {
    const [grants, workspaceChats] = await Promise.all([
      this.repository.listResourceGrants(subject.orgId),
      Promise.all(
        subject.workspaceIds.map((workspaceId) =>
          this.repository.listChats(workspaceId),
        ),
      ),
    ]);
    return workspaceChats
      .flat()
      .filter((chat) =>
        options.archived ? true : chat.archivedAt === undefined,
      )
      .filter((chat) => canReadChat(subject, grants, chat))
      .sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) ||
          left.id.localeCompare(right.id),
      );
  }

  defaultWorkspaceId(subject: AuthSubject): string {
    const workspaceId = subject.workspaceIds[0];
    if (workspaceId === undefined) {
      throw new AuthorizationError("No workspace is available to the caller.");
    }
    return workspaceId;
  }

  toChatTitle(chat: Chat): OpenWebUiChatTitleIdResponse {
    const updatedAt = toEpochSeconds(chat.updatedAt);
    return {
      id: chat.id,
      title: chat.title,
      updated_at: updatedAt,
      created_at: updatedAt,
      last_read_at: null,
    };
  }

  async toChatResponse(
    repository: RomeoRepository,
    subject: AuthSubject,
    chat: Chat,
    knownFolderId?: string | null,
    knownPinned?: boolean,
  ): Promise<OpenWebUiChatResponse> {
    const title = this.toChatTitle(chat);
    const [messages, tags] = await Promise.all([
      repository.listMessages(chat.id),
      repository.listChatTagsForChat(subject.orgId, subject.id, chat.id),
    ]);
    return {
      ...title,
      user_id: chat.createdBy,
      chat: toOpenWebUiChatDocument(chat, messages),
      share_id: null,
      archived: chat.archivedAt !== undefined,
      pinned: knownPinned ?? (await this.isChatPinned(subject, chat.id)),
      meta: tags.length === 0 ? {} : { tags: tags.map((tag) => tag.slug) },
      folder_id:
        knownFolderId === undefined
          ? await this.folderIdForChat(repository, subject, chat)
          : knownFolderId,
      tasks: null,
      summary: null,
    };
  }

  async folderIdForChat(
    repository: RomeoRepository,
    subject: AuthSubject,
    chat: Chat,
  ): Promise<string | null> {
    const grants = await repository.listResourceGrants(subject.orgId);
    const folders = (
      await repository.listWorkspaceFolders(subject.orgId, chat.workspaceId)
    ).filter((folder) => canAccessFolder(subject, grants, folder, "read"));
    for (const folder of folders) {
      const items = await repository.listWorkspaceFolderItems(folder.id);
      if (
        items.some(
          (item) => item.resourceType === "chat" && item.resourceId === chat.id,
        )
      ) {
        return folder.id;
      }
    }
    return null;
  }

  async pinnedChatIds(subject: AuthSubject): Promise<Set<string>> {
    const favorites = await this.repository.listResourceFavorites(
      subject.orgId,
      subject.id,
    );
    return new Set(
      favorites
        .filter((favorite) => favorite.resourceType === "chat")
        .map((favorite) => favorite.resourceId),
    );
  }

  async isChatPinned(subject: AuthSubject, chatId: string): Promise<boolean> {
    return (
      (await this.findPinnedFavorite(this.repository, subject, chatId)) !==
      undefined
    );
  }

  async findPinnedFavorite(
    repository: RomeoRepository,
    subject: AuthSubject,
    chatId: string,
  ): Promise<ResourceFavorite | undefined> {
    return (
      await repository.listResourceFavorites(subject.orgId, subject.id)
    ).find(
      (favorite) =>
        favorite.resourceType === "chat" && favorite.resourceId === chatId,
    );
  }

  async folderedChatIds(
    subject: AuthSubject,
    chats: Chat[],
  ): Promise<Set<string>> {
    const grants = await this.repository.listResourceGrants(subject.orgId);
    const workspaceIds = Array.from(
      new Set(chats.map((chat) => chat.workspaceId)),
    );
    const folders = (
      await Promise.all(
        workspaceIds.map((workspaceId) =>
          this.repository.listWorkspaceFolders(subject.orgId, workspaceId),
        ),
      )
    )
      .flat()
      .filter((folder) => canAccessFolder(subject, grants, folder, "read"));
    const items = (
      await Promise.all(
        folders.map((folder) =>
          this.repository.listWorkspaceFolderItems(folder.id),
        ),
      )
    ).flat();
    return new Set(
      items
        .filter((item) => item.resourceType === "chat")
        .map((item) => item.resourceId),
    );
  }

  assertUserSubject(subject: AuthSubject): void {
    if (subject.type !== "user") {
      throw new AuthorizationError(
        "OpenWebUI chat compatibility is available only for user subjects.",
      );
    }
  }
}

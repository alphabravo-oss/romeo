import {
  AuthorizationError,
  assertScope,
  hasWorkspaceAccess,
  type AuthSubject,
} from "@romeo/auth";
import type {
  OpenWebUiChatResponse,
  OpenWebUiChatTitleIdResponse,
  OpenWebUiCreateChatInput,
  OpenWebUiTagResponse,
} from "@romeo/contracts";

import type { Chat } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { getAuthorizedChat } from "./chat-access";
import {
  canAccessFolder,
  createImportedChatTags,
  createImportedMessages,
  maybePinImportedChat,
  messagesFromOpenWebUiChat,
  titleFromOpenWebUiChat,
  toTagResponse,
  upsertChatTagAssignment,
} from "./openwebui-chat-helpers";
import type { OpenWebUiChatSupport } from "./openwebui-chat-support";
import { paginate } from "./openwebui-compatibility-values";
import { openWebUiTagSlug } from "./openwebui-tags";
import { assertWorkspaceActive } from "./workspace-guard";

export class OpenWebUiChatService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly support: OpenWebUiChatSupport,
  ) {}

  async list(
    subject: AuthSubject,
    options: {
      includeFolders?: boolean;
      includePinned?: boolean;
      page?: number | null;
    } = {},
  ): Promise<OpenWebUiChatTitleIdResponse[]> {
    assertScope(subject, "chats:read");
    const chats = await this.support.visibleChats(subject, { archived: false });
    const [pinnedChatIds, folderedChatIds] = await Promise.all([
      options.includePinned === true
        ? Promise.resolve(new Set<string>())
        : this.support.pinnedChatIds(subject),
      options.includeFolders === true
        ? Promise.resolve(new Set<string>())
        : this.support.folderedChatIds(subject, chats),
    ]);
    const sidebarChats = chats
      .filter(
        (chat) => options.includePinned === true || !pinnedChatIds.has(chat.id),
      )
      .filter(
        (chat) =>
          options.includeFolders === true || !folderedChatIds.has(chat.id),
      );
    return paginate(sidebarChats, options.page, 60).map((chat) =>
      this.support.toChatTitle(chat),
    );
  }

  async pinned(subject: AuthSubject): Promise<OpenWebUiChatTitleIdResponse[]> {
    assertScope(subject, "chats:read");
    this.support.assertUserSubject(subject);
    const [chats, pinnedChatIds] = await Promise.all([
      this.support.visibleChats(subject, { archived: false }),
      this.support.pinnedChatIds(subject),
    ]);
    return chats
      .filter((chat) => pinnedChatIds.has(chat.id))
      .map((chat) => this.support.toChatTitle(chat));
  }

  async pinnedStatus(
    subject: AuthSubject,
    chatId: string,
  ): Promise<boolean | null> {
    assertScope(subject, "chats:read");
    this.support.assertUserSubject(subject);
    await getAuthorizedChat(this.repository, {
      chatId,
      subject,
      scope: "chats:read",
      permission: "read",
    });
    return this.support.isChatPinned(subject, chatId);
  }

  async togglePinned(
    subject: AuthSubject,
    chatId: string,
  ): Promise<OpenWebUiChatResponse> {
    assertScope(subject, "chats:read");
    this.support.assertUserSubject(subject);
    const chat = await getAuthorizedChat(this.repository, {
      chatId,
      subject,
      scope: "chats:read",
      permission: "read",
    });
    const pinned = await this.repository.transaction(async (repository) => {
      const existing = await this.support.findPinnedFavorite(
        repository,
        subject,
        chat.id,
      );
      if (existing !== undefined) {
        await repository.deleteResourceFavorite(existing.id);
        return false;
      }
      await repository.createResourceFavorite({
        id: createId("favorite"),
        orgId: subject.orgId,
        userId: subject.id,
        resourceType: "chat",
        resourceId: chat.id,
        createdAt: new Date().toISOString(),
      });
      return true;
    });
    return this.support.toChatResponse(
      this.repository,
      subject,
      chat,
      undefined,
      pinned,
    );
  }

  async archived(
    subject: AuthSubject,
    options: { page?: number | null } = {},
  ): Promise<OpenWebUiChatTitleIdResponse[]> {
    assertScope(subject, "chats:read");
    const chats = (
      await this.support.visibleChats(subject, { archived: true })
    ).filter((chat) => chat.archivedAt !== undefined);
    return paginate(chats, options.page, 60).map((chat) =>
      this.support.toChatTitle(chat),
    );
  }

  async allArchived(subject: AuthSubject): Promise<OpenWebUiChatResponse[]> {
    assertScope(subject, "chats:read");
    const chats = (
      await this.support.visibleChats(subject, { archived: true })
    ).filter((chat) => chat.archivedAt !== undefined);
    return Promise.all(
      chats.map((chat) =>
        this.support.toChatResponse(this.repository, subject, chat),
      ),
    );
  }

  async search(
    subject: AuthSubject,
    text: string,
    options: { page?: number | null } = {},
  ): Promise<OpenWebUiChatTitleIdResponse[]> {
    assertScope(subject, "chats:read");
    const needle = text.trim().toLowerCase();
    if (needle.length === 0) return this.list(subject, options);
    const chats = await this.support.visibleChats(subject, { archived: false });
    const matches = await Promise.all(
      chats.map(async (chat) => {
        if (chat.title.toLowerCase().includes(needle)) return chat;
        const messages = await this.repository.listMessages(chat.id);
        return messages.some((message) =>
          message.content.toLowerCase().includes(needle),
        )
          ? chat
          : undefined;
      }),
    );
    return paginate(
      matches.filter((chat): chat is Chat => chat !== undefined),
      options.page,
      60,
    ).map((chat) => this.support.toChatTitle(chat));
  }

  async allTags(subject: AuthSubject): Promise<OpenWebUiTagResponse[]> {
    assertScope(subject, "chats:read");
    this.support.assertUserSubject(subject);
    return (await this.repository.listChatTags(subject.orgId, subject.id)).map(
      toTagResponse,
    );
  }

  async byTag(
    subject: AuthSubject,
    name: string,
  ): Promise<OpenWebUiChatTitleIdResponse[]> {
    assertScope(subject, "chats:read");
    this.support.assertUserSubject(subject);
    const slug = openWebUiTagSlug(name);
    if (slug.length === 0) return [];
    const [taggedChatIds, visibleChats] = await Promise.all([
      this.repository.listChatIdsByTag(subject.orgId, subject.id, slug),
      this.support.visibleChats(subject, { archived: false }),
    ]);
    if (taggedChatIds.length === 0) {
      await this.repository.deleteChatTag(subject.orgId, subject.id, slug);
      return [];
    }
    const tagged = new Set(taggedChatIds);
    return visibleChats
      .filter((chat) => tagged.has(chat.id))
      .map((chat) => this.support.toChatTitle(chat));
  }

  async tags(
    subject: AuthSubject,
    chatId: string,
  ): Promise<OpenWebUiTagResponse[]> {
    assertScope(subject, "chats:read");
    this.support.assertUserSubject(subject);
    await getAuthorizedChat(this.repository, {
      chatId,
      subject,
      scope: "chats:read",
      permission: "read",
    });
    return (
      await this.repository.listChatTagsForChat(
        subject.orgId,
        subject.id,
        chatId,
      )
    ).map(toTagResponse);
  }

  async addTag(
    subject: AuthSubject,
    chatId: string,
    name: string,
  ): Promise<OpenWebUiTagResponse[]> {
    const chat = await this.authorizedReadableChat(subject, chatId);
    const slug = openWebUiTagSlug(name);
    if (slug === "none") {
      throw new ApiError(
        "invalid_openwebui_chat_tag",
        "Tag name cannot be 'None'.",
        400,
      );
    }
    if (slug.length === 0) return [];
    await this.repository.transaction((repository) =>
      upsertChatTagAssignment(repository, subject, chat.id, {
        name: name.trim(),
        slug,
      }),
    );
    return this.tags(subject, chat.id);
  }

  async deleteTag(
    subject: AuthSubject,
    chatId: string,
    name: string,
  ): Promise<OpenWebUiTagResponse[]> {
    const chat = await this.authorizedReadableChat(subject, chatId);
    const slug = openWebUiTagSlug(name);
    if (slug.length === 0) return this.tags(subject, chat.id);
    await this.repository.transaction(async (repository) => {
      await repository.deleteChatTagAssignment(
        subject.orgId,
        subject.id,
        chat.id,
        slug,
      );
      if (
        (await repository.countChatTagAssignments(
          subject.orgId,
          subject.id,
          slug,
        )) === 0
      ) {
        await repository.deleteChatTag(subject.orgId, subject.id, slug);
      }
    });
    return this.tags(subject, chat.id);
  }

  async create(
    subject: AuthSubject,
    input: OpenWebUiCreateChatInput,
  ): Promise<OpenWebUiChatResponse> {
    assertScope(subject, "chats:write");
    const workspaceId = this.support.defaultWorkspaceId(subject);
    if (!hasWorkspaceAccess(subject, workspaceId)) {
      throw new AuthorizationError(
        "The workspace is outside the caller access.",
      );
    }
    await assertWorkspaceActive(this.repository, {
      orgId: subject.orgId,
      workspaceId,
    });
    const title = titleFromOpenWebUiChat(input.chat);
    const importedMessages = messagesFromOpenWebUiChat(input.chat);
    const folderId = input.folder_id ?? null;
    if (folderId !== null) {
      const folder = await this.repository.getWorkspaceFolder(folderId);
      const grants = await this.repository.listResourceGrants(subject.orgId);
      if (
        folder === undefined ||
        folder.workspaceId !== workspaceId ||
        !canAccessFolder(subject, grants, folder, "write")
      ) {
        throw notFound("Folder");
      }
    }
    return this.repository.transaction(async (repository) => {
      const now = new Date().toISOString();
      const chat = await repository.createChat({
        id: createId("chat"),
        orgId: subject.orgId,
        workspaceId,
        title,
        createdBy: subject.id,
        updatedAt: now,
      });
      await Promise.all(
        (["read", "write"] as const).map((permission) =>
          repository.createResourceGrant({
            id: createId("grant"),
            resourceType: "chat",
            resourceId: chat.id,
            principalType: subject.type,
            principalId: subject.id,
            permission,
          }),
        ),
      );
      await createImportedMessages(repository, chat.id, importedMessages, now);
      if (folderId !== null) {
        await repository.createWorkspaceFolderItem({
          id: createId("folder_item"),
          orgId: subject.orgId,
          workspaceId,
          folderId,
          resourceType: "chat",
          resourceId: chat.id,
          createdAt: now,
        });
      }
      const pinned = await maybePinImportedChat(
        repository,
        subject,
        chat.id,
        input.chat,
      );
      await createImportedChatTags(
        repository,
        subject,
        chat.id,
        input.chat,
        now,
      );
      return this.support.toChatResponse(
        repository,
        subject,
        chat,
        folderId,
        pinned,
      );
    });
  }

  private async authorizedReadableChat(
    subject: AuthSubject,
    chatId: string,
  ): Promise<Chat> {
    assertScope(subject, "chats:read");
    this.support.assertUserSubject(subject);
    return getAuthorizedChat(this.repository, {
      chatId,
      subject,
      scope: "chats:read",
      permission: "read",
    });
  }
}

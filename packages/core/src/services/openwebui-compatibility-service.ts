import { createHash } from "node:crypto";

import {
  assertScope,
  AuthorizationError,
  canAccessOrg,
  hasGrant,
  hasWorkspaceAccess,
  type AuthSubject,
  type ResourceGrant,
  type Scope,
} from "@romeo/auth";

import type {
  Chat,
  ChatTag,
  Message,
  MessagePart,
  CollaborationChannel,
  CollaborationChannelMember,
  ResourceFavorite,
  User,
  WorkspaceFolder,
  WorkspaceFolderItem,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { canReadChat, getAuthorizedChat } from "./chat-access";
import { openWebUiTagSlug, openWebUiTagsFromChat } from "./openwebui-tags";
import { InMemoryRealtimeEventBus } from "./realtime-event-bus";
import { assertWorkspaceActive } from "./workspace-guard";

export interface OpenWebUiConfigResponse {
  status: true;
  name: string;
  version: string;
  default_locale: string;
  oauth: { providers: Record<string, unknown>; auto_redirect: boolean };
  features: Record<string, boolean | number>;
  default_models: string[];
  default_pinned_models: string[];
  default_prompt_suggestions: unknown[];
  code: { engine: string; interpreter_engine: string };
  audio: {
    tts: { engine: string; voice: string; split_on: string };
    stt: { engine: string };
  };
  file: {
    max_size: number;
    max_count: number;
    image_compression: { width: number; height: number };
  };
  permissions: Record<string, unknown>;
  ui: {
    pending_user_overlay_title: string;
    pending_user_overlay_content: string;
    response_watermark: string;
    iframe_csp: string;
  };
  license_metadata: Record<string, unknown> | null;
}

export interface OpenWebUiVersionResponse {
  version: string;
  deployment_id: string;
}

export interface OpenWebUiVersionUpdatesResponse {
  current: string;
  latest: string;
}

export interface OpenWebUiSessionUserResponse {
  token: null;
  token_type: "Bearer";
  expires_at: null;
  id: string;
  email: string;
  name: string;
  role: "admin" | "user";
  profile_image_url: string;
  permissions: OpenWebUiPermissions;
  bio: null;
  gender: null;
  date_of_birth: null;
  status_emoji: string;
  status_message: string;
  status_expires_at: null;
}

export interface OpenWebUiChatTitleIdResponse {
  id: string;
  title: string;
  updated_at: number;
  created_at: number;
  last_read_at: null;
}

export interface OpenWebUiChatResponse extends OpenWebUiChatTitleIdResponse {
  user_id: string;
  chat: Record<string, unknown>;
  share_id: null;
  archived: boolean;
  pinned: boolean;
  meta: Record<string, unknown>;
  folder_id: string | null;
  tasks: null;
  summary: null;
}

export interface OpenWebUiCreateChatInput {
  chat: Record<string, unknown>;
  folder_id?: string | null;
}

export interface OpenWebUiFolderListItemResponse {
  id: string;
  name: string;
  meta: Record<string, unknown> | null;
  parent_id: string | null;
  is_expanded: boolean;
  created_at: number;
  updated_at: number;
}

export interface OpenWebUiFolderResponse extends OpenWebUiFolderListItemResponse {
  user_id: string;
  items: null;
  data: Record<string, unknown> | null;
}

export interface OpenWebUiCreateFolderInput {
  name: string;
  data?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
  parent_id?: string | null;
}

export interface OpenWebUiUpdateFolderInput {
  name?: string;
  data?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
  parent_id?: string | null;
}

export interface OpenWebUiUpdateChatFolderInput {
  folder_id?: string | null;
}

export interface OpenWebUiTagResponse {
  id: string;
  name: string;
  user_id: string;
  meta: Record<string, unknown> | null;
}

export interface OpenWebUiChannelListItemResponse {
  id: string;
  user_id: string;
  type: string | null;
  name: string;
  description: string | null;
  is_private: boolean | null;
  data: Record<string, unknown> | null;
  meta: Record<string, unknown> | null;
  access_grants: unknown[];
  created_at: number;
  updated_at: number;
  updated_by: string | null;
  archived_at: number | null;
  archived_by: string | null;
  deleted_at: number | null;
  deleted_by: string | null;
  last_message_at: number | null;
  unread_count: number;
  user_ids?: string[];
  users?: OpenWebUiChannelUserResponse[];
}

export interface OpenWebUiChannelResponse extends OpenWebUiChannelListItemResponse {
  is_manager: boolean;
  write_access: boolean;
  user_count: number | null;
  last_read_at: number | null;
}

export interface OpenWebUiChannelUserResponse {
  id: string;
  email: string;
  name: string;
  role: "admin" | "user";
  profile_image_url: string;
  is_active: boolean;
  status_emoji: string;
  status_message: string;
  status_expires_at: null;
}

export interface OpenWebUiChannelMembersResponse {
  users: OpenWebUiChannelUserResponse[];
  total: number;
}

export interface OpenWebUiChannelInput {
  type?: string | undefined;
  name?: string | undefined;
  description?: string | null | undefined;
  is_private?: boolean | null | undefined;
  data?: Record<string, unknown> | null | undefined;
  meta?: Record<string, unknown> | null | undefined;
  access_grants?: Record<string, unknown>[] | undefined;
  group_ids?: string[] | undefined;
  user_ids?: string[] | undefined;
}

export interface OpenWebUiChannelMemberResponse {
  id: string;
  channel_id: string;
  user_id: string;
  role: string | null;
  status: string | null;
  is_active: boolean;
  is_channel_muted: boolean;
  is_channel_pinned: boolean;
  data: Record<string, unknown> | null;
  meta: Record<string, unknown> | null;
  invited_at: number | null;
  invited_by: string | null;
  joined_at: number;
  left_at: number | null;
  last_read_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface OpenWebUiChannelMessageInput {
  temp_id?: string | undefined;
  content: string;
  reply_to_id?: string | undefined;
  parent_id?: string | undefined;
  data?: Record<string, unknown> | null | undefined;
  meta?: Record<string, unknown> | null | undefined;
}

export interface OpenWebUiChannelMessageResponse {
  id: string;
  user_id: string;
  channel_id: string;
  reply_to_id: string | null;
  parent_id: string | null;
  is_pinned: boolean;
  pinned_by: string | null;
  pinned_at: number | null;
  content: string;
  data: Record<string, unknown> | null | boolean;
  meta: Record<string, unknown> | null;
  created_at: number;
  updated_at: number;
  user: OpenWebUiChannelUserResponse | null;
  reply_to_message: OpenWebUiChannelMessageResponse | null;
  latest_reply_at: number | null;
  reply_count: number;
  reactions: unknown[];
}

export type OpenWebUiChannelEventDataType =
  | "channel:connected"
  | "message"
  | "message:reply"
  | "message:update"
  | "message:delete"
  | "message:reaction:add"
  | "message:reaction:remove"
  | "last_read_at";

export interface OpenWebUiChannelEvent {
  id: string;
  channel_id: string;
  message_id: string | null;
  created_at: number;
  data: {
    type: OpenWebUiChannelEventDataType;
    data: unknown;
  };
  user: OpenWebUiChannelUserResponse | null;
  channel: OpenWebUiChannelResponse | null;
}

export interface OpenWebUiChannelEventSubscription {
  connectedEvent: OpenWebUiChannelEvent;
  unsubscribe: () => void;
}

interface OpenWebUiChannelMessageMetadata {
  schema: "romeo.openwebui-channel-message.v1";
  channelId: string;
  userId: string;
  updatedAt?: string | undefined;
  tempId?: string | undefined;
  content?: string | undefined;
  replyToId?: string | undefined;
  parentId?: string | undefined;
  data?: Record<string, unknown> | null | undefined;
  meta?: Record<string, unknown> | null | undefined;
  isPinned?: boolean | undefined;
  pinnedBy?: string | undefined;
  pinnedAt?: string | undefined;
  deletedAt?: string | undefined;
  deletedBy?: string | undefined;
  reactions?: OpenWebUiChannelMessageReaction[] | undefined;
}

interface OpenWebUiChannelMessageReaction {
  userId: string;
  name: string;
}

interface OpenWebUiChannelMessageRecord {
  message: Message;
  metadata: OpenWebUiChannelMessageMetadata;
}

interface OpenWebUiPermissions {
  workspace: Record<string, boolean>;
  features: Record<string, boolean>;
  chat: Record<string, boolean>;
  sharing: Record<string, boolean>;
  settings: Record<string, boolean>;
  access_grants: Record<string, boolean>;
}

const romeoVersion = "0.1.0";
const deploymentId = "romeo";

export class OpenWebUiCompatibilityService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly channelEvents = new InMemoryRealtimeEventBus<OpenWebUiChannelEvent>(),
  ) {}

  config(): OpenWebUiConfigResponse {
    return {
      status: true,
      name: "Romeo",
      version: romeoVersion,
      default_locale: "en-US",
      oauth: { providers: {}, auto_redirect: false },
      features: {
        auth: true,
        auth_trusted_header: false,
        enable_signup_password_confirmation: false,
        enable_ldap: false,
        enable_signup: false,
        enable_login_form: true,
        enable_websocket: false,
        enable_api_keys: true,
        enable_password_change_form: false,
        enable_version_update_check: false,
        enable_public_active_users_count: false,
        enable_easter_eggs: false,
        enable_direct_connections: false,
        enable_folders: true,
        folder_max_file_count: 100,
        enable_channels: true,
        enable_calendar: false,
        enable_automations: true,
        enable_notes: false,
        enable_web_search: false,
        enable_code_execution: false,
        enable_code_interpreter: false,
        enable_image_generation: false,
        enable_autocomplete_generation: false,
        enable_community_sharing: false,
        enable_message_rating: false,
        enable_user_webhooks: true,
        enable_user_status: false,
        enable_admin_export: true,
        enable_admin_chat_access: false,
        enable_admin_analytics: true,
        enable_google_drive_integration: false,
        enable_onedrive_integration: false,
        enable_memories: false,
      },
      default_models: [],
      default_pinned_models: [],
      default_prompt_suggestions: [],
      code: { engine: "disabled", interpreter_engine: "disabled" },
      audio: {
        tts: {
          engine: "romeo",
          voice: "Romeo Neutral",
          split_on: "punctuation",
        },
        stt: { engine: "romeo" },
      },
      file: {
        max_size: 10 * 1024 * 1024,
        max_count: 20,
        image_compression: { width: 1600, height: 1600 },
      },
      permissions: {},
      ui: {
        pending_user_overlay_title: "",
        pending_user_overlay_content: "",
        response_watermark: "",
        iframe_csp: "",
      },
      license_metadata: null,
    };
  }

  version(): OpenWebUiVersionResponse {
    return { version: romeoVersion, deployment_id: deploymentId };
  }

  versionUpdates(): OpenWebUiVersionUpdatesResponse {
    return { current: romeoVersion, latest: romeoVersion };
  }

  async sessionUser(
    subject: AuthSubject,
  ): Promise<OpenWebUiSessionUserResponse> {
    assertScope(subject, "me:read");
    if (subject.type !== "user") {
      throw new AuthorizationError(
        "OpenWebUI session compatibility is available only for user subjects.",
      );
    }
    const user = await this.repository.getCurrentUser(subject.id);
    if (
      user === undefined ||
      user.orgId !== subject.orgId ||
      user.disabledAt !== undefined
    ) {
      throw new AuthorizationError("User session is no longer active.");
    }

    const role = isOpenWebUiAdmin(subject) ? "admin" : "user";
    return {
      token: null,
      token_type: "Bearer",
      expires_at: null,
      id: user.id,
      email: user.email,
      name: user.name,
      role,
      profile_image_url: "",
      permissions: permissionsForSubject(subject),
      bio: null,
      gender: null,
      date_of_birth: null,
      status_emoji: "",
      status_message: "",
      status_expires_at: null,
    };
  }

  async chatList(
    subject: AuthSubject,
    options: {
      includeFolders?: boolean;
      includePinned?: boolean;
      page?: number | null;
    } = {},
  ): Promise<OpenWebUiChatTitleIdResponse[]> {
    assertScope(subject, "chats:read");
    const chats = await this.visibleChats(subject, { archived: false });
    const [pinnedChatIds, folderedChatIds] = await Promise.all([
      options.includePinned === true
        ? Promise.resolve(new Set<string>())
        : this.pinnedChatIds(subject),
      options.includeFolders === true
        ? Promise.resolve(new Set<string>())
        : this.folderedChatIds(subject, chats),
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
      this.toChatTitle(chat),
    );
  }

  async pinnedChats(
    subject: AuthSubject,
  ): Promise<OpenWebUiChatTitleIdResponse[]> {
    assertScope(subject, "chats:read");
    this.assertUserSubject(subject);
    const [chats, pinnedChatIds] = await Promise.all([
      this.visibleChats(subject, { archived: false }),
      this.pinnedChatIds(subject),
    ]);
    return chats
      .filter((chat) => pinnedChatIds.has(chat.id))
      .map((chat) => this.toChatTitle(chat));
  }

  async chatPinnedStatus(
    subject: AuthSubject,
    chatId: string,
  ): Promise<boolean | null> {
    assertScope(subject, "chats:read");
    this.assertUserSubject(subject);
    await getAuthorizedChat(this.repository, {
      chatId,
      subject,
      scope: "chats:read",
      permission: "read",
    });
    return this.isChatPinned(subject, chatId);
  }

  async toggleChatPinned(
    subject: AuthSubject,
    chatId: string,
  ): Promise<OpenWebUiChatResponse> {
    assertScope(subject, "chats:read");
    this.assertUserSubject(subject);
    const chat = await getAuthorizedChat(this.repository, {
      chatId,
      subject,
      scope: "chats:read",
      permission: "read",
    });
    const pinned = await this.repository.transaction(async (repository) => {
      const existing = await this.findPinnedFavorite(
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
    return this.toChatResponse(
      this.repository,
      subject,
      chat,
      undefined,
      pinned,
    );
  }

  async archivedChats(
    subject: AuthSubject,
    options: { page?: number | null } = {},
  ): Promise<OpenWebUiChatTitleIdResponse[]> {
    assertScope(subject, "chats:read");
    const chats = (await this.visibleChats(subject, { archived: true })).filter(
      (chat) => chat.archivedAt !== undefined,
    );
    return paginate(chats, options.page, 60).map((chat) =>
      this.toChatTitle(chat),
    );
  }

  async allArchivedChats(
    subject: AuthSubject,
  ): Promise<OpenWebUiChatResponse[]> {
    assertScope(subject, "chats:read");
    const chats = (await this.visibleChats(subject, { archived: true })).filter(
      (chat) => chat.archivedAt !== undefined,
    );
    return Promise.all(
      chats.map((chat) => this.toChatResponse(this.repository, subject, chat)),
    );
  }

  async searchChats(
    subject: AuthSubject,
    text: string,
    options: { page?: number | null } = {},
  ): Promise<OpenWebUiChatTitleIdResponse[]> {
    assertScope(subject, "chats:read");
    const needle = text.trim().toLowerCase();
    if (needle.length === 0) return this.chatList(subject, options);
    const chats = await this.visibleChats(subject, { archived: false });
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
    ).map((chat) => this.toChatTitle(chat));
  }

  async allTags(subject: AuthSubject): Promise<OpenWebUiTagResponse[]> {
    assertScope(subject, "chats:read");
    this.assertUserSubject(subject);
    return (await this.repository.listChatTags(subject.orgId, subject.id)).map(
      toTagResponse,
    );
  }

  async chatsByTag(
    subject: AuthSubject,
    name: string,
  ): Promise<OpenWebUiChatTitleIdResponse[]> {
    assertScope(subject, "chats:read");
    this.assertUserSubject(subject);
    const slug = openWebUiTagSlug(name);
    if (slug.length === 0) return [];
    const [taggedChatIds, visibleChats] = await Promise.all([
      this.repository.listChatIdsByTag(subject.orgId, subject.id, slug),
      this.visibleChats(subject, { archived: false }),
    ]);
    if (taggedChatIds.length === 0) {
      await this.repository.deleteChatTag(subject.orgId, subject.id, slug);
      return [];
    }
    const tagged = new Set(taggedChatIds);
    return visibleChats
      .filter((chat) => tagged.has(chat.id))
      .map((chat) => this.toChatTitle(chat));
  }

  async chatTags(
    subject: AuthSubject,
    chatId: string,
  ): Promise<OpenWebUiTagResponse[]> {
    assertScope(subject, "chats:read");
    this.assertUserSubject(subject);
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

  async addChatTag(
    subject: AuthSubject,
    chatId: string,
    name: string,
  ): Promise<OpenWebUiTagResponse[]> {
    assertScope(subject, "chats:read");
    this.assertUserSubject(subject);
    const chat = await getAuthorizedChat(this.repository, {
      chatId,
      subject,
      scope: "chats:read",
      permission: "read",
    });
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
    return this.chatTags(subject, chat.id);
  }

  async deleteChatTag(
    subject: AuthSubject,
    chatId: string,
    name: string,
  ): Promise<OpenWebUiTagResponse[]> {
    assertScope(subject, "chats:read");
    this.assertUserSubject(subject);
    const chat = await getAuthorizedChat(this.repository, {
      chatId,
      subject,
      scope: "chats:read",
      permission: "read",
    });
    const slug = openWebUiTagSlug(name);
    if (slug.length === 0) return this.chatTags(subject, chat.id);
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
    return this.chatTags(subject, chat.id);
  }

  async createChat(
    subject: AuthSubject,
    input: OpenWebUiCreateChatInput,
  ): Promise<OpenWebUiChatResponse> {
    assertScope(subject, "chats:write");
    const workspaceId = this.defaultWorkspaceId(subject);
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
      return this.toChatResponse(repository, subject, chat, folderId, pinned);
    });
  }

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
    const chats = (await this.visibleChats(subject, { archived: false }))
      .filter((chat) => chatIds.has(chat.id))
      .filter((chat) => chat.workspaceId === folder.workspaceId);
    const page = paginate(chats, options.page, options.compact ? 10 : 60);
    if (options.compact === true) {
      return page.map((chat) => this.toChatTitle(chat));
    }
    return Promise.all(
      page.map((chat) =>
        this.toChatResponse(this.repository, subject, chat, folder.id),
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
    if (folderId !== null) {
      if (
        destination === undefined ||
        destination.orgId !== chat.orgId ||
        destination.workspaceId !== chat.workspaceId ||
        !canAccessFolder(subject, grants, destination, "write")
      ) {
        throw notFound("Folder");
      }
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
      return this.toChatResponse(repository, subject, chat, folderId);
    });
  }

  async folders(
    subject: AuthSubject,
  ): Promise<OpenWebUiFolderListItemResponse[]> {
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
    return folders.map((folder) => toFolderListItem(folder));
  }

  async folder(
    subject: AuthSubject,
    folderId: string,
  ): Promise<OpenWebUiFolderResponse> {
    assertScope(subject, "me:read");
    const folder = await this.getAuthorizedFolder(subject, folderId, "read");
    return toFolderResponse(folder, subject.id);
  }

  async createFolder(
    subject: AuthSubject,
    input: OpenWebUiCreateFolderInput,
  ): Promise<OpenWebUiFolderResponse> {
    assertScope(subject, "me:read");
    const workspaceId = this.defaultWorkspaceId(subject);
    await assertWorkspaceActive(this.repository, {
      orgId: subject.orgId,
      workspaceId,
    });
    const grants = await this.repository.listResourceGrants(subject.orgId);
    await this.assertValidFolderParent(
      subject,
      grants,
      {
        id: "",
        orgId: subject.orgId,
        workspaceId,
      },
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

  async updateFolder(
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
    await this.assertValidFolderParent(subject, grants, folder, parentId);
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
    const updated = await this.repository.updateWorkspaceFolder(nextFolder);
    return toFolderResponse(updated, subject.id);
  }

  async updateFolderExpanded(
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

  async updateFolderParent(
    subject: AuthSubject,
    folderId: string,
    parentId: string | null,
  ): Promise<OpenWebUiFolderResponse> {
    assertScope(subject, "me:read");
    const folder = await this.getAuthorizedFolder(subject, folderId, "write");
    const grants = await this.repository.listResourceGrants(subject.orgId);
    await this.assertValidFolderParent(subject, grants, folder, parentId);
    const nextFolder: WorkspaceFolder = {
      ...folder,
      updatedAt: new Date().toISOString(),
    };
    if (parentId === null) delete nextFolder.parentId;
    else nextFolder.parentId = parentId;
    const updated = await this.repository.updateWorkspaceFolder(nextFolder);
    return toFolderResponse(updated, subject.id);
  }

  async deleteFolder(
    subject: AuthSubject,
    folderId: string,
    _deleteContents: boolean,
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

  async channels(
    subject: AuthSubject,
  ): Promise<OpenWebUiChannelListItemResponse[]> {
    assertScope(subject, "chats:read");
    this.assertUserSubject(subject);
    const [channels, memberships, users] = await Promise.all([
      this.repository.listCollaborationChannels(subject.orgId),
      this.repository.listCollaborationChannelMembers(subject.orgId),
      this.repository.listUsers(subject.orgId),
    ]);
    const userById = new Map(users.map((user) => [user.id, user]));
    const readableChannels = channels
      .filter((channel) => this.canReadChannel(subject, channel, memberships))
      .filter((channel) => channel.deletedAt === undefined)
      .filter((channel) => channel.archivedAt === undefined)
      .filter((channel) => hasWorkspaceAccess(subject, channel.workspaceId));
    return Promise.all(
      readableChannels.map(async (channel) => {
        const messageRecords = await this.channelMessageRecords(channel);
        return toChannelListItem(
          channel,
          subject,
          memberships.filter((member) => member.channelId === channel.id),
          userById,
          messageRecords,
        );
      }),
    );
  }

  async channelList(
    subject: AuthSubject,
  ): Promise<OpenWebUiChannelListItemResponse[]> {
    return this.channels(subject);
  }

  async createChannel(
    subject: AuthSubject,
    input: OpenWebUiChannelInput,
  ): Promise<OpenWebUiChannelResponse> {
    assertScope(subject, "chats:write");
    this.assertUserSubject(subject);
    const workspaceId = this.defaultWorkspaceId(subject);
    await assertWorkspaceActive(this.repository, {
      orgId: subject.orgId,
      workspaceId,
    });
    const type = normalizeChannelType(input.type);
    if (type === undefined && !isOpenWebUiAdmin(subject)) {
      throw new AuthorizationError("Only admins can create standard channels.");
    }
    const name = normalizeChannelName(input.name ?? "", type);
    const now = new Date().toISOString();
    const memberUserIds = await this.channelMemberUserIds(subject, input, type);
    if (type === "dm") {
      const existing = await this.findDmChannel(subject, memberUserIds);
      if (existing !== undefined) {
        await this.reactivateChannelMember(subject, existing.id, now);
        return this.channel(subject, existing.id);
      }
    }

    const channel = await this.repository.transaction(async (repository) => {
      const created = await repository.createCollaborationChannel({
        id: createId("channel"),
        orgId: subject.orgId,
        workspaceId,
        userId: subject.id,
        ...(type === undefined ? {} : { type }),
        name,
        ...(input.description === undefined || input.description === null
          ? {}
          : { description: input.description.trim() }),
        ...(input.is_private === undefined || input.is_private === null
          ? {}
          : { isPrivate: input.is_private }),
        ...(input.data === undefined || input.data === null
          ? {}
          : { data: input.data }),
        ...(input.meta === undefined || input.meta === null
          ? {}
          : { meta: input.meta }),
        createdAt: now,
        updatedAt: now,
      });
      await Promise.all(
        memberUserIds.map((userId) =>
          repository.createCollaborationChannelMember(
            channelMemberDraft({
              channelId: created.id,
              orgId: subject.orgId,
              userId,
              invitedBy: subject.id,
              now,
              role: userId === subject.id ? "manager" : undefined,
            }),
          ),
        ),
      );
      return created;
    });
    return this.channel(subject, channel.id);
  }

  async dmChannelForUser(
    subject: AuthSubject,
    userId: string,
  ): Promise<OpenWebUiChannelResponse> {
    assertScope(subject, "chats:write");
    this.assertUserSubject(subject);
    if (userId === subject.id) {
      throw new ApiError(
        "invalid_openwebui_channel_member",
        "A direct-message channel requires another user.",
        400,
      );
    }
    return this.createChannel(subject, {
      type: "dm",
      name: "",
      user_ids: [userId],
    });
  }

  async channel(
    subject: AuthSubject,
    channelId: string,
  ): Promise<OpenWebUiChannelResponse> {
    assertScope(subject, "chats:read");
    this.assertUserSubject(subject);
    const channel = await this.authorizedChannel(subject, channelId, "read");
    const [members, users, messageRecords] = await Promise.all([
      this.repository.listCollaborationChannelMembers(
        subject.orgId,
        channel.id,
      ),
      this.repository.listUsers(subject.orgId),
      this.channelMessageRecords(channel),
    ]);
    return toChannelResponse(
      channel,
      subject,
      members,
      new Map(users.map((user) => [user.id, user])),
      this.canWriteChannel(subject, channel, members),
      messageRecords,
    );
  }

  async channelMembers(
    subject: AuthSubject,
    channelId: string,
  ): Promise<OpenWebUiChannelMembersResponse> {
    assertScope(subject, "chats:read");
    this.assertUserSubject(subject);
    const channel = await this.authorizedChannel(subject, channelId, "read");
    const [members, users] = await Promise.all([
      this.repository.listCollaborationChannelMembers(
        subject.orgId,
        channel.id,
      ),
      this.repository.listUsers(subject.orgId),
    ]);
    const activeMembers = members.filter((member) => member.isActive);
    const userById = new Map(users.map((user) => [user.id, user]));
    const responseUsers = activeMembers
      .map((member) => userById.get(member.userId))
      .filter((user): user is User => user !== undefined)
      .map(toChannelUserResponse);
    return { users: responseUsers, total: responseUsers.length };
  }

  async subscribeChannelEvents(
    subject: AuthSubject,
    channelId: string,
    handler: (event: OpenWebUiChannelEvent) => void,
  ): Promise<OpenWebUiChannelEventSubscription> {
    assertScope(subject, "chats:read");
    this.assertUserSubject(subject);
    const channel = await this.authorizedChannel(subject, channelId, "read");
    return {
      connectedEvent: await this.toChannelEvent(
        subject,
        channel,
        null,
        "channel:connected",
        { channel_id: channel.id },
      ),
      unsubscribe: this.channelEvents.subscribe(
        channelEventBusKey(subject.orgId, channel.id),
        handler,
      ),
    };
  }

  async channelMessages(
    subject: AuthSubject,
    channelId: string,
    input: { skip?: number | undefined; limit?: number | undefined } = {},
  ): Promise<OpenWebUiChannelMessageResponse[]> {
    assertScope(subject, "chats:read");
    this.assertUserSubject(subject);
    const channel = await this.authorizedChannel(subject, channelId, "read");
    const [records, users] = await Promise.all([
      this.channelMessageRecords(channel),
      this.repository.listUsers(subject.orgId),
    ]);
    const skip = boundedOffset(input.skip);
    const limit = boundedLimit(input.limit, 50, 200);
    const topLevelRecords = records
      .filter((record) => record.metadata.parentId === undefined)
      .sort((left, right) =>
        compareIsoDesc(left.message.createdAt, right.message.createdAt),
      )
      .slice(skip, skip + limit);
    const userById = new Map(users.map((user) => [user.id, user]));
    return topLevelRecords.map((record) =>
      toChannelMessageResponse(record, userById, records),
    );
  }

  async postChannelMessage(
    subject: AuthSubject,
    channelId: string,
    input: OpenWebUiChannelMessageInput,
  ): Promise<OpenWebUiChannelMessageResponse> {
    assertScope(subject, "chats:write");
    this.assertUserSubject(subject);
    const channel = await this.authorizedChannel(subject, channelId, "read");
    const members = await this.repository.listCollaborationChannelMembers(
      subject.orgId,
      channel.id,
    );
    if (!this.canPostChannelMessage(subject, channel, members)) {
      throw new AuthorizationError(
        `Missing write permission for channel:${channel.id}`,
      );
    }
    const now = new Date().toISOString();
    const content = normalizeChannelMessageContent(input.content);
    const result = await this.repository.transaction(async (repository) => {
      const chat = await ensureChannelBackingChat(repository, channel, now);
      const message = await repository.createMessage({
        id: createId("message"),
        chatId: chat.id,
        role: "user",
        content,
        createdAt: now,
      });
      const metadata: OpenWebUiChannelMessageMetadata = {
        schema: "romeo.openwebui-channel-message.v1",
        channelId: channel.id,
        userId: subject.id,
        updatedAt: now,
        content,
        ...(input.temp_id === undefined ? {} : { tempId: input.temp_id }),
        ...(input.reply_to_id === undefined
          ? {}
          : { replyToId: input.reply_to_id }),
        ...(input.parent_id === undefined ? {} : { parentId: input.parent_id }),
        ...(input.data === undefined ? {} : { data: input.data }),
        ...(input.meta === undefined ? {} : { meta: input.meta }),
      };
      await repository.createMessageParts([
        {
          id: createId("message_part"),
          messageId: message.id,
          type: "collaboration_channel_metadata",
          content: "",
          metadata: { ...metadata },
        },
      ]);
      await repository.updateChat({ ...chat, updatedAt: now });
      await repository.updateCollaborationChannel({
        ...channel,
        updatedAt: now,
        updatedBy: subject.id,
      });
      return { message, metadata };
    });
    const users = await this.repository.listUsers(subject.orgId);
    const records = await this.channelMessageRecords(channel);
    const mergedRecords = records.some(
      (record) => record.message.id === result.message.id,
    )
      ? records
      : [...records, result];
    const userById = new Map(users.map((user) => [user.id, user]));
    const response = toChannelMessageResponse(result, userById, mergedRecords);
    await this.publishChannelEvent(subject, channel, response.id, "message", {
      ...(input.temp_id === undefined ? {} : { temp_id: input.temp_id }),
      ...response,
    });
    if (response.parent_id !== null) {
      const parentRecord = mergedRecords.find(
        (record) => record.message.id === response.parent_id,
      );
      if (parentRecord !== undefined) {
        await this.publishChannelEvent(
          subject,
          channel,
          parentRecord.message.id,
          "message:reply",
          toChannelMessageResponse(parentRecord, userById, mergedRecords),
        );
      }
    }
    return response;
  }

  async markChannelRead(
    subject: AuthSubject,
    channelId: string,
  ): Promise<boolean> {
    assertScope(subject, "chats:write");
    this.assertUserSubject(subject);
    const channel = await this.authorizedChannel(subject, channelId, "read");
    const member = await this.repository.getCollaborationChannelMember(
      channel.id,
      subject.id,
    );
    if (member === undefined) throw notFound("Channel member");
    const now = new Date().toISOString();
    await this.repository.updateCollaborationChannelMember({
      ...member,
      lastReadAt: now,
      updatedAt: now,
    });
    await this.publishChannelEvent(subject, channel, null, "last_read_at", {
      user_id: subject.id,
      last_read_at: toEpochSeconds(now),
    });
    return true;
  }

  async pinnedChannelMessages(
    subject: AuthSubject,
    channelId: string,
    input: { page?: number | undefined } = {},
  ): Promise<OpenWebUiChannelMessageResponse[]> {
    assertScope(subject, "chats:read");
    this.assertUserSubject(subject);
    const channel = await this.authorizedChannel(subject, channelId, "read");
    const [records, users] = await Promise.all([
      this.channelMessageRecords(channel),
      this.repository.listUsers(subject.orgId),
    ]);
    const page = boundedPage(input.page);
    const userById = new Map(users.map((user) => [user.id, user]));
    return records
      .filter((record) => record.metadata.isPinned === true)
      .sort((left, right) =>
        compareIsoDesc(
          left.metadata.pinnedAt ?? left.message.createdAt,
          right.metadata.pinnedAt ?? right.message.createdAt,
        ),
      )
      .slice((page - 1) * 20, page * 20)
      .map((record) => toChannelMessageResponse(record, userById, records));
  }

  async channelMessage(
    subject: AuthSubject,
    channelId: string,
    messageId: string,
  ): Promise<OpenWebUiChannelMessageResponse> {
    assertScope(subject, "chats:read");
    this.assertUserSubject(subject);
    const { record, records } = await this.authorizedChannelMessage(
      subject,
      channelId,
      messageId,
    );
    const users = await this.repository.listUsers(subject.orgId);
    return toChannelMessageResponse(
      record,
      new Map(users.map((user) => [user.id, user])),
      records,
    );
  }

  async channelMessageData(
    subject: AuthSubject,
    channelId: string,
    messageId: string,
  ): Promise<Record<string, unknown> | null> {
    assertScope(subject, "chats:read");
    this.assertUserSubject(subject);
    const { record } = await this.authorizedChannelMessage(
      subject,
      channelId,
      messageId,
    );
    return record.metadata.data ?? null;
  }

  async channelThreadMessages(
    subject: AuthSubject,
    channelId: string,
    messageId: string,
    input: { skip?: number | undefined; limit?: number | undefined } = {},
  ): Promise<OpenWebUiChannelMessageResponse[]> {
    assertScope(subject, "chats:read");
    this.assertUserSubject(subject);
    const { records } = await this.authorizedChannelMessage(
      subject,
      channelId,
      messageId,
    );
    const skip = boundedOffset(input.skip);
    const limit = boundedLimit(input.limit, 50, 200);
    const users = await this.repository.listUsers(subject.orgId);
    const userById = new Map(users.map((user) => [user.id, user]));
    return records
      .filter((record) => record.metadata.parentId === messageId)
      .sort((left, right) =>
        left.message.createdAt.localeCompare(right.message.createdAt),
      )
      .slice(skip, skip + limit)
      .map((record) => toChannelMessageResponse(record, userById, records));
  }

  async pinChannelMessage(
    subject: AuthSubject,
    channelId: string,
    messageId: string,
    isPinned: boolean,
  ): Promise<OpenWebUiChannelMessageResponse> {
    assertScope(subject, "chats:write");
    this.assertUserSubject(subject);
    const { channel, record, records } = await this.authorizedChannelMessage(
      subject,
      channelId,
      messageId,
    );
    const members = await this.repository.listCollaborationChannelMembers(
      subject.orgId,
      channel.id,
    );
    if (!this.canPinChannelMessage(subject, channel, members)) {
      throw new AuthorizationError(
        `Missing write permission for channel:${channel.id}`,
      );
    }
    const now = new Date().toISOString();
    const metadata: OpenWebUiChannelMessageMetadata = {
      ...record.metadata,
      updatedAt: now,
      isPinned,
      ...(isPinned ? { pinnedBy: subject.id, pinnedAt: now } : {}),
    };
    if (!isPinned) {
      delete metadata.pinnedBy;
      delete metadata.pinnedAt;
    }
    await appendChannelMessageMetadata(
      this.repository,
      record.message.id,
      metadata,
    );
    const users = await this.repository.listUsers(subject.orgId);
    const nextRecords = replaceChannelMessageRecord(
      records,
      record.message.id,
      metadata,
    );
    const response = toChannelMessageResponse(
      { message: record.message, metadata },
      new Map(users.map((user) => [user.id, user])),
      nextRecords,
    );
    await this.publishChannelEvent(
      subject,
      channel,
      record.message.id,
      "message:update",
      response,
    );
    return response;
  }

  async updateChannelMessage(
    subject: AuthSubject,
    channelId: string,
    messageId: string,
    input: OpenWebUiChannelMessageInput,
  ): Promise<OpenWebUiChannelMessageResponse> {
    assertScope(subject, "chats:write");
    this.assertUserSubject(subject);
    const { channel, record, records } = await this.authorizedChannelMessage(
      subject,
      channelId,
      messageId,
    );
    const members = await this.repository.listCollaborationChannelMembers(
      subject.orgId,
      channel.id,
    );
    if (!this.canMutateChannelMessage(subject, channel, members, record)) {
      throw new AuthorizationError(
        `Missing message mutation permission for channel:${channel.id}`,
      );
    }
    const metadata: OpenWebUiChannelMessageMetadata = {
      ...record.metadata,
      updatedAt: new Date().toISOString(),
      content: normalizeChannelMessageContent(input.content),
      ...(input.data === undefined ? {} : { data: input.data }),
      ...(input.meta === undefined ? {} : { meta: input.meta }),
    };
    await appendChannelMessageMetadata(
      this.repository,
      record.message.id,
      metadata,
    );
    const users = await this.repository.listUsers(subject.orgId);
    const nextRecords = replaceChannelMessageRecord(
      records,
      record.message.id,
      metadata,
    );
    const response = toChannelMessageResponse(
      { message: record.message, metadata },
      new Map(users.map((user) => [user.id, user])),
      nextRecords,
    );
    await this.publishChannelEvent(
      subject,
      channel,
      record.message.id,
      "message:update",
      response,
    );
    return response;
  }

  async addChannelMessageReaction(
    subject: AuthSubject,
    channelId: string,
    messageId: string,
    name: string,
  ): Promise<boolean> {
    return this.updateChannelMessageReaction(
      subject,
      channelId,
      messageId,
      name,
      "add",
    );
  }

  async removeChannelMessageReaction(
    subject: AuthSubject,
    channelId: string,
    messageId: string,
    name: string,
  ): Promise<boolean> {
    return this.updateChannelMessageReaction(
      subject,
      channelId,
      messageId,
      name,
      "remove",
    );
  }

  async deleteChannelMessage(
    subject: AuthSubject,
    channelId: string,
    messageId: string,
  ): Promise<boolean> {
    assertScope(subject, "chats:write");
    this.assertUserSubject(subject);
    const { channel, record, records } = await this.authorizedChannelMessage(
      subject,
      channelId,
      messageId,
    );
    const members = await this.repository.listCollaborationChannelMembers(
      subject.orgId,
      channel.id,
    );
    if (!this.canMutateChannelMessage(subject, channel, members, record)) {
      throw new AuthorizationError(
        `Missing message mutation permission for channel:${channel.id}`,
      );
    }
    const now = new Date().toISOString();
    await appendChannelMessageMetadata(this.repository, record.message.id, {
      ...record.metadata,
      updatedAt: now,
      deletedAt: now,
      deletedBy: subject.id,
    });
    const users = await this.repository.listUsers(subject.orgId);
    const userById = new Map(users.map((user) => [user.id, user]));
    await this.publishChannelEvent(
      subject,
      channel,
      record.message.id,
      "message:delete",
      toChannelMessageResponse(record, userById, records),
    );
    if (record.metadata.parentId !== undefined) {
      const parentRecord = records.find(
        (candidate) => candidate.message.id === record.metadata.parentId,
      );
      if (parentRecord !== undefined) {
        const remainingRecords = records.filter(
          (candidate) => candidate.message.id !== record.message.id,
        );
        await this.publishChannelEvent(
          subject,
          channel,
          parentRecord.message.id,
          "message:reply",
          toChannelMessageResponse(parentRecord, userById, remainingRecords),
        );
      }
    }
    return true;
  }

  private async updateChannelMessageReaction(
    subject: AuthSubject,
    channelId: string,
    messageId: string,
    name: string,
    action: "add" | "remove",
  ): Promise<boolean> {
    assertScope(subject, "chats:write");
    this.assertUserSubject(subject);
    const { channel, record, records } = await this.authorizedChannelMessage(
      subject,
      channelId,
      messageId,
    );
    const members = await this.repository.listCollaborationChannelMembers(
      subject.orgId,
      channel.id,
    );
    if (!this.canPinChannelMessage(subject, channel, members)) {
      throw new AuthorizationError(
        `Missing write permission for channel:${channel.id}`,
      );
    }
    const reactionName = normalizeReactionName(name);
    const current = record.metadata.reactions ?? [];
    const withoutCurrent = current.filter(
      (reaction) =>
        reaction.userId !== subject.id || reaction.name !== reactionName,
    );
    const reactions =
      action === "add"
        ? [...withoutCurrent, { userId: subject.id, name: reactionName }]
        : withoutCurrent;
    const metadata: OpenWebUiChannelMessageMetadata = {
      ...record.metadata,
      updatedAt: new Date().toISOString(),
      reactions,
    };
    await appendChannelMessageMetadata(
      this.repository,
      record.message.id,
      metadata,
    );
    const users = await this.repository.listUsers(subject.orgId);
    const nextRecords = replaceChannelMessageRecord(
      records,
      record.message.id,
      metadata,
    );
    await this.publishChannelEvent(
      subject,
      channel,
      record.message.id,
      action === "add" ? "message:reaction:add" : "message:reaction:remove",
      {
        ...toChannelMessageResponse(
          { message: record.message, metadata },
          new Map(users.map((user) => [user.id, user])),
          nextRecords,
        ),
        name: reactionName,
      },
    );
    return true;
  }

  async updateChannelMemberActiveStatus(
    subject: AuthSubject,
    channelId: string,
    isActive: boolean,
  ): Promise<boolean> {
    assertScope(subject, "chats:write");
    this.assertUserSubject(subject);
    const channel = await this.authorizedChannel(subject, channelId, "read");
    const member = await this.repository.getCollaborationChannelMember(
      channel.id,
      subject.id,
    );
    if (member === undefined) throw notFound("Channel member");
    const now = new Date().toISOString();
    await this.repository.updateCollaborationChannelMember({
      ...member,
      isActive,
      status: isActive ? "joined" : "left",
      updatedAt: now,
      ...(isActive ? {} : { leftAt: now }),
    });
    return true;
  }

  async addChannelMembers(
    subject: AuthSubject,
    channelId: string,
    input: {
      user_ids?: string[] | undefined;
      group_ids?: string[] | undefined;
    },
  ): Promise<OpenWebUiChannelMemberResponse[]> {
    assertScope(subject, "chats:write");
    this.assertUserSubject(subject);
    const channel = await this.authorizedChannel(subject, channelId, "write");
    const now = new Date().toISOString();
    const userIds = await this.channelMemberUserIds(
      subject,
      {
        name: channel.name,
        user_ids: input.user_ids,
        group_ids: input.group_ids,
      },
      normalizeChannelType(channel.type),
    );
    const created = await this.repository.transaction(async (repository) =>
      Promise.all(
        userIds.map((userId) =>
          repository.createCollaborationChannelMember(
            channelMemberDraft({
              channelId: channel.id,
              orgId: subject.orgId,
              userId,
              invitedBy: subject.id,
              now,
              role: userId === subject.id ? "manager" : undefined,
            }),
          ),
        ),
      ),
    );
    return created.map(toChannelMemberResponse);
  }

  async removeChannelMembers(
    subject: AuthSubject,
    channelId: string,
    input: { user_ids?: string[] | undefined },
  ): Promise<number> {
    assertScope(subject, "chats:write");
    this.assertUserSubject(subject);
    const channel = await this.authorizedChannel(subject, channelId, "write");
    const userIds = [...new Set(input.user_ids ?? [])].filter(
      (userId) => userId !== subject.id,
    );
    const deleted = await this.repository.deleteCollaborationChannelMembers(
      channel.id,
      userIds,
    );
    return deleted.length;
  }

  async updateChannel(
    subject: AuthSubject,
    channelId: string,
    input: OpenWebUiChannelInput,
  ): Promise<OpenWebUiChannelResponse> {
    assertScope(subject, "chats:write");
    this.assertUserSubject(subject);
    const channel = await this.authorizedChannel(subject, channelId, "write");
    const type = normalizeChannelType(channel.type);
    const name =
      input.name === undefined
        ? channel.name
        : normalizeChannelName(input.name, type);
    const next: CollaborationChannel = {
      ...channel,
      name,
      updatedAt: new Date().toISOString(),
      updatedBy: subject.id,
    };
    if (input.description !== undefined) {
      if (input.description === null) delete next.description;
      else next.description = input.description.trim();
    }
    if (input.is_private !== undefined) {
      if (input.is_private === null) delete next.isPrivate;
      else next.isPrivate = input.is_private;
    }
    if (input.data !== undefined) {
      if (input.data === null) delete next.data;
      else next.data = input.data;
    }
    if (input.meta !== undefined) {
      if (input.meta === null) delete next.meta;
      else next.meta = input.meta;
    }
    await this.repository.updateCollaborationChannel(next);
    if (
      (input.user_ids?.length ?? 0) > 0 ||
      (input.group_ids?.length ?? 0) > 0
    ) {
      await this.addChannelMembers(subject, channel.id, {
        user_ids: input.user_ids,
        group_ids: input.group_ids,
      });
    }
    return this.channel(subject, channel.id);
  }

  async deleteChannel(
    subject: AuthSubject,
    channelId: string,
  ): Promise<boolean> {
    assertScope(subject, "chats:write");
    this.assertUserSubject(subject);
    const channel = await this.authorizedChannel(subject, channelId, "write");
    await this.repository.deleteCollaborationChannel(channel.id);
    return true;
  }

  private async publishChannelEvent(
    subject: AuthSubject,
    channel: CollaborationChannel,
    messageId: string | null,
    type: OpenWebUiChannelEventDataType,
    data: unknown,
  ): Promise<void> {
    this.channelEvents.publish(
      channelEventBusKey(subject.orgId, channel.id),
      await this.toChannelEvent(subject, channel, messageId, type, data),
    );
  }

  private async toChannelEvent(
    subject: AuthSubject,
    channel: CollaborationChannel,
    messageId: string | null,
    type: OpenWebUiChannelEventDataType,
    data: unknown,
  ): Promise<OpenWebUiChannelEvent> {
    const [members, users, messageRecords] = await Promise.all([
      this.repository.listCollaborationChannelMembers(
        subject.orgId,
        channel.id,
      ),
      this.repository.listUsers(subject.orgId),
      this.channelMessageRecords(channel),
    ]);
    const userById = new Map(users.map((user) => [user.id, user]));
    const user = users.find((candidate) => candidate.id === subject.id);
    return {
      id: createId("openwebui_channel_event"),
      channel_id: channel.id,
      message_id: messageId,
      created_at: toEpochSeconds(new Date().toISOString()),
      data: { type, data },
      user: user === undefined ? null : toChannelUserResponse(user),
      channel: toChannelResponse(
        channel,
        subject,
        members,
        userById,
        this.canWriteChannel(subject, channel, members),
        messageRecords,
      ),
    };
  }

  private async visibleChats(
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

  private defaultWorkspaceId(subject: AuthSubject): string {
    const workspaceId = subject.workspaceIds[0];
    if (workspaceId === undefined) {
      throw new AuthorizationError("No workspace is available to the caller.");
    }
    return workspaceId;
  }

  private toChatTitle(chat: Chat): OpenWebUiChatTitleIdResponse {
    const updatedAt = toEpochSeconds(chat.updatedAt);
    return {
      id: chat.id,
      title: chat.title,
      updated_at: updatedAt,
      created_at: updatedAt,
      last_read_at: null,
    };
  }

  private async toChatResponse(
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

  private async folderIdForChat(
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

  private async pinnedChatIds(subject: AuthSubject): Promise<Set<string>> {
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

  private async isChatPinned(
    subject: AuthSubject,
    chatId: string,
  ): Promise<boolean> {
    return (
      (await this.findPinnedFavorite(this.repository, subject, chatId)) !==
      undefined
    );
  }

  private async findPinnedFavorite(
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

  private async folderedChatIds(
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

  private assertUserSubject(subject: AuthSubject): void {
    if (subject.type !== "user") {
      throw new AuthorizationError(
        "OpenWebUI chat compatibility is available only for user subjects.",
      );
    }
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

  private async assertValidFolderParent(
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

  private async authorizedChannel(
    subject: AuthSubject,
    channelId: string,
    permission: "read" | "write",
  ): Promise<CollaborationChannel> {
    const channel = await this.repository.getCollaborationChannel(channelId);
    if (
      channel === undefined ||
      channel.orgId !== subject.orgId ||
      channel.deletedAt !== undefined ||
      channel.archivedAt !== undefined ||
      !hasWorkspaceAccess(subject, channel.workspaceId)
    ) {
      throw notFound("Channel");
    }
    const members = await this.repository.listCollaborationChannelMembers(
      subject.orgId,
      channel.id,
    );
    const allowed =
      permission === "read"
        ? this.canReadChannel(subject, channel, members)
        : this.canWriteChannel(subject, channel, members);
    if (!allowed) {
      throw new AuthorizationError(
        `Missing ${permission} permission for channel:${channel.id}`,
      );
    }
    return channel;
  }

  private canReadChannel(
    subject: AuthSubject,
    channel: CollaborationChannel,
    members: CollaborationChannelMember[],
  ): boolean {
    if (!canAccessOrg(subject, channel.orgId)) return false;
    if (!hasWorkspaceAccess(subject, channel.workspaceId)) return false;
    if (subject.isAdmin === true || channel.userId === subject.id) return true;
    const type = normalizeChannelType(channel.type);
    if (type === "group" || type === "dm") {
      return members.some(
        (member) => member.userId === subject.id && member.isActive,
      );
    }
    return false;
  }

  private canWriteChannel(
    subject: AuthSubject,
    channel: CollaborationChannel,
    members: CollaborationChannelMember[],
  ): boolean {
    if (!canAccessOrg(subject, channel.orgId)) return false;
    if (!hasWorkspaceAccess(subject, channel.workspaceId)) return false;
    if (subject.isAdmin === true || channel.userId === subject.id) return true;
    return members.some(
      (member) =>
        member.userId === subject.id &&
        member.isActive &&
        member.role === "manager",
    );
  }

  private canPostChannelMessage(
    subject: AuthSubject,
    channel: CollaborationChannel,
    members: CollaborationChannelMember[],
  ): boolean {
    const type = normalizeChannelType(channel.type);
    if (type === "group" || type === "dm") {
      return this.canReadChannel(subject, channel, members);
    }
    return this.canWriteChannel(subject, channel, members);
  }

  private canPinChannelMessage(
    subject: AuthSubject,
    channel: CollaborationChannel,
    members: CollaborationChannelMember[],
  ): boolean {
    const type = normalizeChannelType(channel.type);
    if (type === "group" || type === "dm") {
      return this.canReadChannel(subject, channel, members);
    }
    return this.canWriteChannel(subject, channel, members);
  }

  private canMutateChannelMessage(
    subject: AuthSubject,
    channel: CollaborationChannel,
    members: CollaborationChannelMember[],
    record: OpenWebUiChannelMessageRecord,
  ): boolean {
    if (subject.isAdmin === true || channel.userId === subject.id) return true;
    if (record.metadata.userId === subject.id) {
      return this.canReadChannel(subject, channel, members);
    }
    return this.canWriteChannel(subject, channel, members);
  }

  private async authorizedChannelMessage(
    subject: AuthSubject,
    channelId: string,
    messageId: string,
  ): Promise<{
    channel: CollaborationChannel;
    record: OpenWebUiChannelMessageRecord;
    records: OpenWebUiChannelMessageRecord[];
  }> {
    const channel = await this.authorizedChannel(subject, channelId, "read");
    const records = await this.channelMessageRecords(channel);
    const record = records.find(
      (candidate) => candidate.message.id === messageId,
    );
    if (record === undefined) throw notFound("Channel message");
    return { channel, record, records };
  }

  private async channelMessageRecords(
    channel: CollaborationChannel,
  ): Promise<OpenWebUiChannelMessageRecord[]> {
    const chat = await this.repository.getChat(
      channelBackingChatId(channel.id),
    );
    if (chat === undefined) return [];
    const messages = await this.repository.listMessages(chat.id);
    const withParts = await Promise.all(
      messages.map(async (message) => ({
        message,
        parts: await this.repository.listMessageParts(message.id),
      })),
    );
    return withParts
      .map(({ message, parts }) => {
        const metadata = channelMessageMetadataFromParts(parts, channel.id);
        return metadata === undefined || metadata.deletedAt !== undefined
          ? undefined
          : { message, metadata };
      })
      .filter(
        (record): record is OpenWebUiChannelMessageRecord =>
          record !== undefined,
      );
  }

  private async channelMemberUserIds(
    subject: AuthSubject,
    input: Pick<OpenWebUiChannelInput, "group_ids" | "name" | "user_ids">,
    type: string | undefined,
  ): Promise<string[]> {
    const requested = new Set<string>(input.user_ids ?? []);
    requested.add(subject.id);
    for (const groupId of input.group_ids ?? []) {
      const memberships = await this.repository.listGroupMemberships(
        subject.orgId,
        groupId,
      );
      for (const membership of memberships) requested.add(membership.userId);
    }
    if (type === "dm" && requested.size < 2) {
      throw new ApiError(
        "invalid_openwebui_channel_member",
        "A direct-message channel requires at least two users.",
        400,
      );
    }
    const users = await this.repository.listUsers(subject.orgId);
    const validUsers = new Set(
      users
        .filter((user) => user.disabledAt === undefined)
        .map((user) => user.id),
    );
    const invalid = [...requested].filter((userId) => !validUsers.has(userId));
    if (invalid.length > 0) {
      throw new ApiError(
        "invalid_openwebui_channel_member",
        "Channel members must be active users in the caller organization.",
        400,
        { userIds: invalid },
      );
    }
    return [...requested].sort();
  }

  private async findDmChannel(
    subject: AuthSubject,
    userIds: string[],
  ): Promise<CollaborationChannel | undefined> {
    const channels = (
      await this.repository.listCollaborationChannels(subject.orgId)
    )
      .filter((channel) => normalizeChannelType(channel.type) === "dm")
      .filter((channel) => channel.deletedAt === undefined);
    const wanted = [...userIds].sort();
    for (const channel of channels) {
      const members = await this.repository.listCollaborationChannelMembers(
        subject.orgId,
        channel.id,
      );
      const memberIds = members.map((member) => member.userId).sort();
      if (
        memberIds.length === wanted.length &&
        memberIds.every((userId, index) => userId === wanted[index])
      ) {
        return channel;
      }
    }
    return undefined;
  }

  private async reactivateChannelMember(
    subject: AuthSubject,
    channelId: string,
    now: string,
  ): Promise<void> {
    const member = await this.repository.getCollaborationChannelMember(
      channelId,
      subject.id,
    );
    if (member === undefined || member.isActive) return;
    const next: CollaborationChannelMember = {
      ...member,
      isActive: true,
      status: "joined",
      updatedAt: now,
      lastReadAt: now,
    };
    delete next.leftAt;
    await this.repository.updateCollaborationChannelMember(next);
  }
}

function normalizeChannelType(value: unknown): string | undefined {
  const type = trimmedString(value);
  if (type === undefined) return undefined;
  if (type === "group" || type === "dm") return type;
  throw new ApiError(
    "invalid_openwebui_channel",
    "Channel type must be group, dm, or empty.",
    400,
  );
}

function normalizeChannelName(name: string, type: string | undefined): string {
  const normalized = name.trim().replace(/\s+/gu, "-").toLowerCase();
  if (type === "dm") return normalized.slice(0, 128);
  if (normalized.length === 0) {
    throw new ApiError(
      "invalid_openwebui_channel",
      "Channel name must not be empty.",
      400,
    );
  }
  return normalized.slice(0, 128);
}

function channelMemberDraft(input: {
  channelId: string;
  orgId: string;
  userId: string;
  invitedBy: string;
  now: string;
  role?: string | undefined;
}): CollaborationChannelMember {
  return {
    id: createId("openwebui_channel_member"),
    orgId: input.orgId,
    channelId: input.channelId,
    userId: input.userId,
    ...(input.role === undefined ? {} : { role: input.role }),
    status: "joined",
    isActive: true,
    isChannelMuted: false,
    isChannelPinned: false,
    invitedAt: input.now,
    invitedBy: input.invitedBy,
    joinedAt: input.now,
    lastReadAt: input.now,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

function channelBackingChatId(channelId: string): string {
  const digest = createHash("sha256").update(channelId).digest("hex");
  return `chat_openwebui_${digest.slice(0, 24)}`;
}

function channelEventBusKey(orgId: string, channelId: string): string {
  return `${orgId}:openwebui-channel:${channelId}`;
}

async function ensureChannelBackingChat(
  repository: RomeoRepository,
  channel: CollaborationChannel,
  now: string,
): Promise<Chat> {
  const id = channelBackingChatId(channel.id);
  const existing = await repository.getChat(id);
  if (existing !== undefined) return existing;
  return repository.createChat({
    id,
    orgId: channel.orgId,
    workspaceId: channel.workspaceId,
    title: `Channel: ${channel.name}`.slice(0, 200),
    createdBy: channel.userId,
    updatedAt: now,
  });
}

function normalizeChannelMessageContent(content: string): string {
  const normalized = content.trim();
  if (normalized.length === 0) {
    throw new ApiError(
      "invalid_openwebui_channel_message",
      "Channel message content must not be empty.",
      400,
    );
  }
  return normalized.slice(0, 20_000);
}

function boundedOffset(value: number | undefined): number {
  if (value === undefined || !Number.isInteger(value) || value < 0) return 0;
  return Math.min(value, 100_000);
}

function boundedLimit(
  value: number | undefined,
  fallback: number,
  max: number,
): number {
  if (value === undefined || !Number.isInteger(value) || value <= 0) {
    return fallback;
  }
  return Math.min(value, max);
}

function boundedPage(value: number | undefined): number {
  if (value === undefined || !Number.isInteger(value) || value <= 0) return 1;
  return Math.min(value, 10_000);
}

function compareIsoDesc(left: string, right: string): number {
  return right.localeCompare(left);
}

function channelMessageMetadataFromParts(
  parts: MessagePart[],
  channelId: string,
): OpenWebUiChannelMessageMetadata | undefined {
  let latest: OpenWebUiChannelMessageMetadata | undefined;
  for (const part of parts) {
    if (part.type !== "collaboration_channel_metadata") continue;
    const metadata = asRecord(part.metadata);
    if (metadata?.schema !== "romeo.openwebui-channel-message.v1") continue;
    if (metadata.channelId !== channelId) continue;
    const userId = trimmedString(metadata.userId);
    if (userId === undefined) continue;
    const data =
      metadata.data === null ? null : (asRecord(metadata.data) ?? undefined);
    const meta =
      metadata.meta === null ? null : (asRecord(metadata.meta) ?? undefined);
    const candidate: OpenWebUiChannelMessageMetadata = {
      schema: "romeo.openwebui-channel-message.v1",
      channelId,
      userId,
      ...(trimmedString(metadata.updatedAt) === undefined
        ? {}
        : { updatedAt: trimmedString(metadata.updatedAt) }),
      ...(trimmedString(metadata.tempId) === undefined
        ? {}
        : { tempId: trimmedString(metadata.tempId) }),
      ...(trimmedString(metadata.content) === undefined
        ? {}
        : { content: trimmedString(metadata.content) }),
      ...(trimmedString(metadata.replyToId) === undefined
        ? {}
        : { replyToId: trimmedString(metadata.replyToId) }),
      ...(trimmedString(metadata.parentId) === undefined
        ? {}
        : { parentId: trimmedString(metadata.parentId) }),
      ...(data === undefined ? {} : { data }),
      ...(meta === undefined ? {} : { meta }),
      ...(metadata.isPinned === true ? { isPinned: true } : {}),
      ...(trimmedString(metadata.pinnedBy) === undefined
        ? {}
        : { pinnedBy: trimmedString(metadata.pinnedBy) }),
      ...(trimmedString(metadata.pinnedAt) === undefined
        ? {}
        : { pinnedAt: trimmedString(metadata.pinnedAt) }),
      ...(trimmedString(metadata.deletedAt) === undefined
        ? {}
        : { deletedAt: trimmedString(metadata.deletedAt) }),
      ...(trimmedString(metadata.deletedBy) === undefined
        ? {}
        : { deletedBy: trimmedString(metadata.deletedBy) }),
      ...(reactionsFromMetadata(metadata.reactions).length === 0
        ? {}
        : { reactions: reactionsFromMetadata(metadata.reactions) }),
    };
    if (
      latest === undefined ||
      (candidate.updatedAt ?? "") >= (latest.updatedAt ?? "")
    ) {
      latest = candidate;
    }
  }
  return latest;
}

function reactionsFromMetadata(
  value: unknown,
): OpenWebUiChannelMessageReaction[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const reactions: OpenWebUiChannelMessageReaction[] = [];
  for (const item of value) {
    const record = asRecord(item);
    const userId = trimmedString(record?.userId);
    const name = trimmedString(record?.name);
    if (userId === undefined || name === undefined) continue;
    const key = `${userId}:${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    reactions.push({ userId, name });
  }
  return reactions.slice(0, 500);
}

function normalizeReactionName(name: string): string {
  const normalized = name.trim();
  if (normalized.length === 0 || normalized.length > 120) {
    throw new ApiError(
      "invalid_openwebui_channel_reaction",
      "Channel message reaction must be between 1 and 120 characters.",
      400,
    );
  }
  return normalized;
}

async function appendChannelMessageMetadata(
  repository: RomeoRepository,
  messageId: string,
  metadata: OpenWebUiChannelMessageMetadata,
): Promise<void> {
  await repository.createMessageParts([
    {
      id: createId("message_part"),
      messageId,
      type: "collaboration_channel_metadata",
      content: "",
      metadata: { ...metadata },
    },
  ]);
}

function replaceChannelMessageRecord(
  records: OpenWebUiChannelMessageRecord[],
  messageId: string,
  metadata: OpenWebUiChannelMessageMetadata,
): OpenWebUiChannelMessageRecord[] {
  return records.map((record) =>
    record.message.id === messageId ? { ...record, metadata } : record,
  );
}

function toChannelListItem(
  channel: CollaborationChannel,
  subject: AuthSubject,
  members: CollaborationChannelMember[],
  userById: Map<string, User>,
  messageRecords: OpenWebUiChannelMessageRecord[] = [],
): OpenWebUiChannelListItemResponse {
  const type = normalizeChannelType(channel.type) ?? null;
  const callerMember = members.find((member) => member.userId === subject.id);
  const item: OpenWebUiChannelListItemResponse = {
    ...toChannelBase(channel),
    last_message_at: channelLastMessageAt(messageRecords),
    unread_count: channelUnreadCount(messageRecords, callerMember, subject.id),
  };
  if (type === "dm") {
    item.user_ids = members.map((member) => member.userId).sort();
    item.users = item.user_ids
      .map((userId) => userById.get(userId))
      .filter((user): user is User => user !== undefined)
      .map(toChannelUserResponse);
  }
  if (callerMember?.isChannelPinned === true) {
    item.meta = { ...(item.meta ?? {}), is_channel_pinned: true };
  }
  return item;
}

function toChannelResponse(
  channel: CollaborationChannel,
  subject: AuthSubject,
  members: CollaborationChannelMember[],
  userById: Map<string, User>,
  writeAccess: boolean,
  messageRecords: OpenWebUiChannelMessageRecord[] = [],
): OpenWebUiChannelResponse {
  const listItem = toChannelListItem(
    channel,
    subject,
    members,
    userById,
    messageRecords,
  );
  const activeMembers = members.filter((member) => member.isActive);
  if (normalizeChannelType(channel.type) === "group") {
    listItem.user_ids = activeMembers.map((member) => member.userId).sort();
    listItem.users = listItem.user_ids
      .map((userId) => userById.get(userId))
      .filter((user): user is User => user !== undefined)
      .map(toChannelUserResponse);
  }
  const callerMember = members.find((member) => member.userId === subject.id);
  return {
    ...listItem,
    is_manager:
      subject.isAdmin === true ||
      channel.userId === subject.id ||
      callerMember?.role === "manager",
    write_access: writeAccess,
    user_count: activeMembers.length,
    last_read_at:
      callerMember?.lastReadAt === undefined
        ? null
        : toEpochSeconds(callerMember.lastReadAt),
  };
}

function toChannelBase(
  channel: CollaborationChannel,
): Omit<
  OpenWebUiChannelListItemResponse,
  "last_message_at" | "unread_count" | "user_ids" | "users"
> {
  return {
    id: channel.id,
    user_id: channel.userId,
    type: normalizeChannelType(channel.type) ?? null,
    name: channel.name,
    description: channel.description ?? null,
    is_private: channel.isPrivate ?? null,
    data: channel.data ?? null,
    meta: channel.meta ?? null,
    access_grants: [],
    created_at: toEpochSeconds(channel.createdAt),
    updated_at: toEpochSeconds(channel.updatedAt),
    updated_by: channel.updatedBy ?? null,
    archived_at:
      channel.archivedAt === undefined
        ? null
        : toEpochSeconds(channel.archivedAt),
    archived_by: channel.archivedBy ?? null,
    deleted_at:
      channel.deletedAt === undefined
        ? null
        : toEpochSeconds(channel.deletedAt),
    deleted_by: channel.deletedBy ?? null,
  };
}

function toChannelUserResponse(user: User): OpenWebUiChannelUserResponse {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: "user",
    profile_image_url: "",
    is_active: user.disabledAt === undefined,
    status_emoji: "",
    status_message: "",
    status_expires_at: null,
  };
}

function toChannelMemberResponse(
  member: CollaborationChannelMember,
): OpenWebUiChannelMemberResponse {
  return {
    id: member.id,
    channel_id: member.channelId,
    user_id: member.userId,
    role: member.role ?? null,
    status: member.status ?? null,
    is_active: member.isActive,
    is_channel_muted: member.isChannelMuted,
    is_channel_pinned: member.isChannelPinned,
    data: member.data ?? null,
    meta: member.meta ?? null,
    invited_at:
      member.invitedAt === undefined ? null : toEpochSeconds(member.invitedAt),
    invited_by: member.invitedBy ?? null,
    joined_at: toEpochSeconds(member.joinedAt),
    left_at: member.leftAt === undefined ? null : toEpochSeconds(member.leftAt),
    last_read_at:
      member.lastReadAt === undefined
        ? null
        : toEpochSeconds(member.lastReadAt),
    created_at: toEpochSeconds(member.createdAt),
    updated_at: toEpochSeconds(member.updatedAt),
  };
}

function toChannelMessageResponse(
  record: OpenWebUiChannelMessageRecord,
  userById: Map<string, User>,
  records: OpenWebUiChannelMessageRecord[],
  options: { includeReply?: boolean } = {},
): OpenWebUiChannelMessageResponse {
  const replies = records.filter(
    (candidate) => candidate.metadata.parentId === record.message.id,
  );
  const latestReply = [...replies].sort((left, right) =>
    compareIsoDesc(left.message.createdAt, right.message.createdAt),
  )[0];
  const replyToRecord =
    options.includeReply === false || record.metadata.replyToId === undefined
      ? undefined
      : records.find(
          (candidate) => candidate.message.id === record.metadata.replyToId,
        );
  const user = userById.get(record.metadata.userId);
  return {
    id: record.message.id,
    user_id: record.metadata.userId,
    channel_id: record.metadata.channelId,
    reply_to_id: record.metadata.replyToId ?? null,
    parent_id: record.metadata.parentId ?? null,
    is_pinned: record.metadata.isPinned === true,
    pinned_by: record.metadata.pinnedBy ?? null,
    pinned_at:
      record.metadata.pinnedAt === undefined
        ? null
        : toEpochSeconds(record.metadata.pinnedAt),
    content: record.metadata.content ?? record.message.content,
    data: channelMessageDataValue(record.metadata.data),
    meta: record.metadata.meta ?? null,
    created_at: toEpochSeconds(record.message.createdAt),
    updated_at: toEpochSeconds(
      record.metadata.updatedAt ?? record.message.createdAt,
    ),
    user: user === undefined ? null : toChannelUserResponse(user),
    reply_to_message:
      replyToRecord === undefined
        ? null
        : toChannelMessageResponse(replyToRecord, userById, records, {
            includeReply: false,
          }),
    latest_reply_at:
      latestReply === undefined
        ? null
        : toEpochSeconds(latestReply.message.createdAt),
    reply_count: replies.length,
    reactions: channelMessageReactionResponses(record.metadata.reactions ?? []),
  };
}

function channelMessageReactionResponses(
  reactions: OpenWebUiChannelMessageReaction[],
): Array<{ name: string; user_id: string }> {
  return reactions.map((reaction) => ({
    user_id: reaction.userId,
    name: reaction.name,
  }));
}

function channelMessageDataValue(
  data: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null | boolean {
  if (data === undefined || data === null) return false;
  return data;
}

function channelLastMessageAt(
  records: OpenWebUiChannelMessageRecord[],
): number | null {
  const latest = records
    .filter((record) => record.metadata.parentId === undefined)
    .sort((left, right) =>
      compareIsoDesc(left.message.createdAt, right.message.createdAt),
    )[0];
  return latest === undefined ? null : toEpochSeconds(latest.message.createdAt);
}

function channelUnreadCount(
  records: OpenWebUiChannelMessageRecord[],
  callerMember: CollaborationChannelMember | undefined,
  userId: string,
): number {
  if (callerMember === undefined || callerMember.isActive !== true) return 0;
  return records.filter((record) => {
    if (record.metadata.userId === userId) return false;
    if (callerMember.lastReadAt === undefined) return true;
    return record.message.createdAt > callerMember.lastReadAt;
  }).length;
}

async function createImportedMessages(
  repository: RomeoRepository,
  chatId: string,
  messages: Array<Pick<Message, "content" | "createdAt" | "role">>,
  fallbackCreatedAt: string,
): Promise<void> {
  for (const [index, message] of messages.entries()) {
    await repository.createMessage({
      id: createId("message"),
      chatId,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt || offsetIso(fallbackCreatedAt, index),
    });
  }
}

async function createImportedChatTags(
  repository: RomeoRepository,
  subject: AuthSubject,
  chatId: string,
  chat: Record<string, unknown>,
  fallbackCreatedAt: string,
): Promise<void> {
  if (subject.type !== "user") return;
  for (const tag of openWebUiTagsFromChat(chat)) {
    await upsertChatTagAssignment(repository, subject, chatId, {
      ...tag,
      createdAt: fallbackCreatedAt,
    });
  }
}

async function upsertChatTagAssignment(
  repository: RomeoRepository,
  subject: AuthSubject,
  chatId: string,
  tag: { name: string; slug: string; createdAt?: string },
): Promise<void> {
  const now = tag.createdAt ?? new Date().toISOString();
  const chatTag = await repository.upsertChatTag({
    id: createId("chat_tag"),
    orgId: subject.orgId,
    userId: subject.id,
    slug: tag.slug,
    name: tag.name,
    createdAt: now,
    updatedAt: now,
  });
  await repository.createChatTagAssignment({
    id: createId("chat_tag_assignment"),
    orgId: subject.orgId,
    userId: subject.id,
    chatId,
    tagId: chatTag.id,
    createdAt: now,
  });
}

function toTagResponse(tag: ChatTag): OpenWebUiTagResponse {
  return {
    id: tag.slug,
    name: tag.name,
    user_id: tag.userId,
    meta: tag.meta ?? null,
  };
}

async function maybePinImportedChat(
  repository: RomeoRepository,
  subject: AuthSubject,
  chatId: string,
  chat: Record<string, unknown>,
): Promise<boolean> {
  if (chat.pinned !== true || subject.type !== "user") return false;
  await repository.createResourceFavorite({
    id: createId("favorite"),
    orgId: subject.orgId,
    userId: subject.id,
    resourceType: "chat",
    resourceId: chatId,
    createdAt: new Date().toISOString(),
  });
  return true;
}

function offsetIso(baseIso: string, offsetMs: number): string {
  return new Date(new Date(baseIso).getTime() + offsetMs).toISOString();
}

function titleFromOpenWebUiChat(chat: Record<string, unknown>): string {
  const explicitTitle = trimmedString(chat.title);
  if (explicitTitle !== undefined) return explicitTitle.slice(0, 200);
  const firstUserMessage = messagesFromOpenWebUiChat(chat).find(
    (message) => message.role === "user",
  );
  if (firstUserMessage !== undefined) {
    return firstUserMessage.content.replace(/\s+/gu, " ").slice(0, 80);
  }
  return "New Chat";
}

function messagesFromOpenWebUiChat(
  chat: Record<string, unknown>,
): Array<Pick<Message, "content" | "createdAt" | "role">> {
  const history = asRecord(chat.history);
  const messageMap = asRecord(history?.messages);
  const currentId = trimmedString(history?.currentId);
  const rawMessages =
    messageMap === undefined
      ? arrayRecords(chat.messages)
      : orderedHistoryMessages(messageMap, currentId);
  return rawMessages
    .map(toMessageDraft)
    .filter(
      (message): message is Pick<Message, "content" | "createdAt" | "role"> =>
        message !== undefined,
    )
    .slice(0, 200);
}

function orderedHistoryMessages(
  messages: Record<string, unknown>,
  currentId?: string,
): Record<string, unknown>[] {
  const records = Object.values(messages)
    .map(asRecord)
    .filter((item): item is Record<string, unknown> => item !== undefined);
  if (currentId === undefined) return sortOpenWebUiMessages(records);
  const byId = new Map(
    records
      .map((message) => [trimmedString(message.id), message] as const)
      .filter(
        (entry): entry is readonly [string, Record<string, unknown>] =>
          entry[0] !== undefined,
      ),
  );
  const chain: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined = currentId;
  while (cursor !== undefined && !seen.has(cursor)) {
    seen.add(cursor);
    const message = byId.get(cursor);
    if (message === undefined) break;
    chain.push(message);
    cursor = trimmedString(message.parentId);
  }
  return chain.length === 0 ? sortOpenWebUiMessages(records) : chain.reverse();
}

function sortOpenWebUiMessages(
  messages: Record<string, unknown>[],
): Record<string, unknown>[] {
  return [...messages].sort(
    (left, right) =>
      numericTimestamp(left.timestamp) - numericTimestamp(right.timestamp),
  );
}

function toMessageDraft(
  message: Record<string, unknown>,
): Pick<Message, "content" | "createdAt" | "role"> | undefined {
  const role = messageRole(message.role);
  if (role === undefined) return undefined;
  const content = textContent(message.content);
  if (content.trim().length === 0) return undefined;
  return {
    role,
    content: content.slice(0, 20_000),
    createdAt: timestampToIso(message.timestamp),
  };
}

function toOpenWebUiChatDocument(
  chat: Chat,
  messages: Message[],
): Record<string, unknown> {
  const ordered = [...messages].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id),
  );
  const historyMessages: Record<string, unknown> = {};
  for (const [index, message] of ordered.entries()) {
    const previous = ordered[index - 1];
    const next = ordered[index + 1];
    historyMessages[message.id] = {
      id: message.id,
      parentId: previous?.id ?? null,
      childrenIds: next === undefined ? [] : [next.id],
      role: message.role,
      content: message.content,
      timestamp: toEpochSeconds(message.createdAt),
      models: [],
    };
  }
  return {
    id: chat.id,
    title: chat.title,
    history: {
      messages: historyMessages,
      currentId: ordered.at(-1)?.id ?? null,
    },
    messages: ordered.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      timestamp: toEpochSeconds(message.createdAt),
    })),
  };
}

function toFolderListItem(
  folder: WorkspaceFolder,
): OpenWebUiFolderListItemResponse {
  return {
    id: folder.id,
    name: folder.name,
    meta: folder.meta ?? null,
    parent_id: folder.parentId ?? null,
    is_expanded: folder.isExpanded ?? false,
    created_at: toEpochSeconds(folder.createdAt),
    updated_at: toEpochSeconds(folder.updatedAt),
  };
}

function toFolderResponse(
  folder: WorkspaceFolder,
  userId: string,
): OpenWebUiFolderResponse {
  return {
    ...toFolderListItem(folder),
    user_id: userId,
    items: null,
    data: folder.data ?? null,
  };
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
  ) {
    return true;
  }
  return hasGrant(subject, grants, "folder", folder.id, "write");
}

function paginate<T>(
  items: T[],
  page: number | null | undefined,
  limit: number,
): T[] {
  if (page === undefined || page === null) return items;
  const boundedPage = Number.isInteger(page) && page > 0 ? page : 1;
  return items.slice((boundedPage - 1) * limit, boundedPage * limit);
}

function toEpochSeconds(iso: string): number {
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return 0;
  return Math.floor(timestamp / 1000);
}

function timestampToIso(value: unknown): string {
  const seconds = numericTimestamp(value);
  if (seconds <= 0) return new Date().toISOString();
  return new Date(seconds * 1000).toISOString();
}

function numericTimestamp(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function messageRole(value: unknown): Message["role"] | undefined {
  if (
    value === "assistant" ||
    value === "system" ||
    value === "tool" ||
    value === "user"
  ) {
    return value;
  }
  return undefined;
}

function textContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        const record = asRecord(item);
        if (record === undefined) return "";
        if (record.type === "text") return trimmedString(record.text) ?? "";
        return "";
      })
      .filter((part) => part.length > 0)
      .join("\n");
  }
  return "";
}

function trimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function arrayRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value
        .map(asRecord)
        .filter((item): item is Record<string, unknown> => item !== undefined)
    : [];
}

function isOpenWebUiAdmin(subject: AuthSubject): boolean {
  return (
    subject.isAdmin === true ||
    subject.groupIds.includes("group_admins") ||
    subject.scopes.includes("admin:read") ||
    subject.scopes.includes("admin:write")
  );
}

function permissionsForSubject(subject: AuthSubject): OpenWebUiPermissions {
  const can = (scope: Scope) => subject.scopes.includes(scope);
  const canAny = (...scopes: Scope[]) => scopes.some((scope) => can(scope));
  return {
    workspace: {
      models: canAny("models:read", "models:use"),
      models_import: can("models:read"),
      models_export: can("models:read"),
      knowledge: can("knowledge:read"),
      prompts: can("agents:read"),
      prompts_import: can("agents:write"),
      prompts_export: can("agents:read"),
      tools: canAny("tools:use", "tools:manage"),
      tools_import: can("tools:manage"),
      tools_export: can("tools:manage"),
      skills: false,
    },
    features: {
      api_keys: can("admin:write"),
      automations: canAny("runs:create", "agents:run"),
      calendar: false,
      channels: can("chats:read"),
      code_interpreter: false,
      direct_tool_servers: can("tools:manage"),
      folders: can("chats:read"),
      image_generation: false,
      memories: false,
      notes: false,
      web_search: false,
    },
    chat: {
      call: can("runs:create"),
      continue_response: can("runs:create"),
      controls: can("runs:create"),
      delete_message: can("chats:write"),
      edit: can("chats:write"),
      export: can("chats:read"),
      file_upload: can("chats:write"),
      multiple_models: can("models:use"),
      rate_response: false,
      regenerate_response: can("runs:create"),
      share: can("chats:read"),
      stt: can("voices:use"),
      temporary: can("runs:create"),
      temporary_enforced: false,
      tts: can("voices:use"),
      valves: false,
      web_upload: can("knowledge:write"),
    },
    sharing: {
      knowledge: can("knowledge:read"),
      models: can("models:read"),
      notes: false,
      prompts: can("agents:read"),
      public_chats: false,
      public_knowledge: false,
      public_models: false,
      public_notes: false,
      public_prompts: false,
      public_skills: false,
      public_tools: false,
      skills: false,
      tools: can("tools:use"),
    },
    settings: { interface: true },
    access_grants: { allow_users: false },
  };
}

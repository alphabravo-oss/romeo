import type { AuthSubject } from "@romeo/auth";
import type {
  OpenWebUiChannelEvent,
  OpenWebUiChannelInput,
  OpenWebUiChannelListItemResponse,
  OpenWebUiChannelMemberResponse,
  OpenWebUiChannelMembersResponse,
  OpenWebUiChannelMessageInput,
  OpenWebUiChannelMessageResponse,
  OpenWebUiChannelResponse,
  OpenWebUiChatResponse,
  OpenWebUiChatTitleIdResponse,
  OpenWebUiConfigResponse,
  OpenWebUiCreateChatInput,
  OpenWebUiCreateFolderInput,
  OpenWebUiFolderListItemResponse,
  OpenWebUiFolderResponse,
  OpenWebUiSessionUserResponse,
  OpenWebUiTagResponse,
  OpenWebUiUpdateChatFolderInput,
  OpenWebUiUpdateFolderInput,
  OpenWebUiVersionResponse,
  OpenWebUiVersionUpdatesResponse,
} from "@romeo/contracts";

import type { RomeoRepository } from "../domain/repository";
import { OpenWebUiChannelAccess } from "./openwebui-channel-access";
import {
  OpenWebUiChannelEvents,
  type OpenWebUiChannelEventSubscription,
} from "./openwebui-channel-events";
import { OpenWebUiChannelMessageQueries } from "./openwebui-channel-message-queries";
import { OpenWebUiChannelMessageCommands } from "./openwebui-channel-message-commands";
import { OpenWebUiChannelQueries } from "./openwebui-channel-queries";
import { OpenWebUiChannelCommands } from "./openwebui-channel-commands";
import { OpenWebUiChatSupport } from "./openwebui-chat-support";
import { OpenWebUiChatService } from "./openwebui-chat-service";
import { OpenWebUiBootstrapService } from "./openwebui-bootstrap-service";
import { OpenWebUiFolderService } from "./openwebui-folder-service";
import { InMemoryRealtimeEventBus } from "./realtime-event-bus";

export type { OpenWebUiChannelEventSubscription } from "./openwebui-channel-events";

export class OpenWebUiCompatibilityService {
  private readonly bootstrap: OpenWebUiBootstrapService;
  private readonly channelAccess: OpenWebUiChannelAccess;
  private readonly channelEventService: OpenWebUiChannelEvents;
  private readonly channelMessageQueries: OpenWebUiChannelMessageQueries;
  private readonly channelMessageCommands: OpenWebUiChannelMessageCommands;
  private readonly channelQueries: OpenWebUiChannelQueries;
  private readonly channelCommands: OpenWebUiChannelCommands;
  private readonly chatSupport: OpenWebUiChatSupport;
  private readonly chatsService: OpenWebUiChatService;
  private readonly foldersService: OpenWebUiFolderService;

  constructor(
    repository: RomeoRepository,
    channelEvents = new InMemoryRealtimeEventBus<OpenWebUiChannelEvent>(),
  ) {
    this.bootstrap = new OpenWebUiBootstrapService(repository);
    this.channelAccess = new OpenWebUiChannelAccess(repository);
    this.channelEventService = new OpenWebUiChannelEvents(
      repository,
      this.channelAccess,
      channelEvents,
    );
    this.channelMessageQueries = new OpenWebUiChannelMessageQueries(
      repository,
      this.channelAccess,
    );
    this.channelMessageCommands = new OpenWebUiChannelMessageCommands(
      repository,
      this.channelAccess,
      this.channelEventService,
    );
    this.channelQueries = new OpenWebUiChannelQueries(
      repository,
      this.channelAccess,
    );
    this.channelCommands = new OpenWebUiChannelCommands(
      repository,
      this.channelAccess,
      this.channelQueries,
    );
    this.chatSupport = new OpenWebUiChatSupport(repository);
    this.chatsService = new OpenWebUiChatService(repository, this.chatSupport);
    this.foldersService = new OpenWebUiFolderService(
      repository,
      this.chatSupport,
    );
  }

  config(): OpenWebUiConfigResponse {
    return this.bootstrap.config();
  }

  version(): OpenWebUiVersionResponse {
    return this.bootstrap.version();
  }

  versionUpdates(): OpenWebUiVersionUpdatesResponse {
    return this.bootstrap.versionUpdates();
  }

  sessionUser(subject: AuthSubject): Promise<OpenWebUiSessionUserResponse> {
    return this.bootstrap.sessionUser(subject);
  }

  chatList(
    subject: AuthSubject,
    options: {
      includeFolders?: boolean;
      includePinned?: boolean;
      page?: number | null;
    } = {},
  ): Promise<OpenWebUiChatTitleIdResponse[]> {
    return this.chatsService.list(subject, options);
  }

  pinnedChats(subject: AuthSubject): Promise<OpenWebUiChatTitleIdResponse[]> {
    return this.chatsService.pinned(subject);
  }

  chatPinnedStatus(
    subject: AuthSubject,
    chatId: string,
  ): Promise<boolean | null> {
    return this.chatsService.pinnedStatus(subject, chatId);
  }

  toggleChatPinned(
    subject: AuthSubject,
    chatId: string,
  ): Promise<OpenWebUiChatResponse> {
    return this.chatsService.togglePinned(subject, chatId);
  }

  archivedChats(
    subject: AuthSubject,
    options: { page?: number | null } = {},
  ): Promise<OpenWebUiChatTitleIdResponse[]> {
    return this.chatsService.archived(subject, options);
  }

  allArchivedChats(subject: AuthSubject): Promise<OpenWebUiChatResponse[]> {
    return this.chatsService.allArchived(subject);
  }

  searchChats(
    subject: AuthSubject,
    text: string,
    options: { page?: number | null } = {},
  ): Promise<OpenWebUiChatTitleIdResponse[]> {
    return this.chatsService.search(subject, text, options);
  }

  allTags(subject: AuthSubject): Promise<OpenWebUiTagResponse[]> {
    return this.chatsService.allTags(subject);
  }

  chatsByTag(
    subject: AuthSubject,
    name: string,
  ): Promise<OpenWebUiChatTitleIdResponse[]> {
    return this.chatsService.byTag(subject, name);
  }

  chatTags(
    subject: AuthSubject,
    chatId: string,
  ): Promise<OpenWebUiTagResponse[]> {
    return this.chatsService.tags(subject, chatId);
  }

  addChatTag(
    subject: AuthSubject,
    chatId: string,
    name: string,
  ): Promise<OpenWebUiTagResponse[]> {
    return this.chatsService.addTag(subject, chatId, name);
  }

  deleteChatTag(
    subject: AuthSubject,
    chatId: string,
    name: string,
  ): Promise<OpenWebUiTagResponse[]> {
    return this.chatsService.deleteTag(subject, chatId, name);
  }

  createChat(
    subject: AuthSubject,
    input: OpenWebUiCreateChatInput,
  ): Promise<OpenWebUiChatResponse> {
    return this.chatsService.create(subject, input);
  }

  async chatsByFolder(
    subject: AuthSubject,
    folderId: string,
    options?: { compact?: false; page?: number | null },
  ): Promise<OpenWebUiChatResponse[]>;
  async chatsByFolder(
    subject: AuthSubject,
    folderId: string,
    options: { compact: true; page?: number | null },
  ): Promise<OpenWebUiChatTitleIdResponse[]>;
  async chatsByFolder(
    subject: AuthSubject,
    folderId: string,
    options: { compact?: boolean; page?: number | null } = {},
  ): Promise<OpenWebUiChatResponse[] | OpenWebUiChatTitleIdResponse[]> {
    return this.foldersService.chatsByFolder(subject, folderId, options);
  }

  updateChatFolder(
    subject: AuthSubject,
    chatId: string,
    input: OpenWebUiUpdateChatFolderInput,
  ): Promise<OpenWebUiChatResponse> {
    return this.foldersService.updateChatFolder(subject, chatId, input);
  }

  folders(subject: AuthSubject): Promise<OpenWebUiFolderListItemResponse[]> {
    return this.foldersService.list(subject);
  }

  folder(
    subject: AuthSubject,
    folderId: string,
  ): Promise<OpenWebUiFolderResponse> {
    return this.foldersService.get(subject, folderId);
  }

  createFolder(
    subject: AuthSubject,
    input: OpenWebUiCreateFolderInput,
  ): Promise<OpenWebUiFolderResponse> {
    return this.foldersService.create(subject, input);
  }

  updateFolder(
    subject: AuthSubject,
    folderId: string,
    input: OpenWebUiUpdateFolderInput,
  ): Promise<OpenWebUiFolderResponse> {
    return this.foldersService.update(subject, folderId, input);
  }

  updateFolderExpanded(
    subject: AuthSubject,
    folderId: string,
    isExpanded: boolean,
  ): Promise<OpenWebUiFolderResponse> {
    return this.foldersService.updateExpanded(subject, folderId, isExpanded);
  }

  updateFolderParent(
    subject: AuthSubject,
    folderId: string,
    parentId: string | null,
  ): Promise<OpenWebUiFolderResponse> {
    return this.foldersService.updateParent(subject, folderId, parentId);
  }

  deleteFolder(
    subject: AuthSubject,
    folderId: string,
    _deleteContents: boolean,
  ): Promise<OpenWebUiFolderResponse> {
    return this.foldersService.delete(subject, folderId);
  }

  channels(subject: AuthSubject): Promise<OpenWebUiChannelListItemResponse[]> {
    return this.channelQueries.list(subject);
  }

  channelList(
    subject: AuthSubject,
  ): Promise<OpenWebUiChannelListItemResponse[]> {
    return this.channelQueries.list(subject);
  }

  createChannel(
    subject: AuthSubject,
    input: OpenWebUiChannelInput,
  ): Promise<OpenWebUiChannelResponse> {
    return this.channelCommands.create(subject, input);
  }

  dmChannelForUser(
    subject: AuthSubject,
    userId: string,
  ): Promise<OpenWebUiChannelResponse> {
    return this.channelCommands.dm(subject, userId);
  }

  channel(
    subject: AuthSubject,
    channelId: string,
  ): Promise<OpenWebUiChannelResponse> {
    return this.channelQueries.get(subject, channelId);
  }

  channelMembers(
    subject: AuthSubject,
    channelId: string,
  ): Promise<OpenWebUiChannelMembersResponse> {
    return this.channelQueries.members(subject, channelId);
  }

  subscribeChannelEvents(
    subject: AuthSubject,
    channelId: string,
    handler: (event: OpenWebUiChannelEvent) => void,
  ): Promise<OpenWebUiChannelEventSubscription> {
    return this.channelEventService.subscribe(subject, channelId, handler);
  }

  channelMessages(
    subject: AuthSubject,
    channelId: string,
    input: { skip?: number | undefined; limit?: number | undefined } = {},
  ): Promise<OpenWebUiChannelMessageResponse[]> {
    return this.channelMessageQueries.list(subject, channelId, input);
  }

  postChannelMessage(
    subject: AuthSubject,
    channelId: string,
    input: OpenWebUiChannelMessageInput,
  ): Promise<OpenWebUiChannelMessageResponse> {
    return this.channelMessageCommands.post(subject, channelId, input);
  }

  markChannelRead(subject: AuthSubject, channelId: string): Promise<boolean> {
    return this.channelMessageCommands.markRead(subject, channelId);
  }

  pinnedChannelMessages(
    subject: AuthSubject,
    channelId: string,
    input: { page?: number | undefined } = {},
  ): Promise<OpenWebUiChannelMessageResponse[]> {
    return this.channelMessageQueries.pinned(subject, channelId, input);
  }

  channelMessage(
    subject: AuthSubject,
    channelId: string,
    messageId: string,
  ): Promise<OpenWebUiChannelMessageResponse> {
    return this.channelMessageQueries.get(subject, channelId, messageId);
  }

  channelMessageData(
    subject: AuthSubject,
    channelId: string,
    messageId: string,
  ): Promise<Record<string, unknown> | null> {
    return this.channelMessageQueries.data(subject, channelId, messageId);
  }

  channelThreadMessages(
    subject: AuthSubject,
    channelId: string,
    messageId: string,
    input: { skip?: number | undefined; limit?: number | undefined } = {},
  ): Promise<OpenWebUiChannelMessageResponse[]> {
    return this.channelMessageQueries.thread(
      subject,
      channelId,
      messageId,
      input,
    );
  }

  pinChannelMessage(
    subject: AuthSubject,
    channelId: string,
    messageId: string,
    isPinned: boolean,
  ): Promise<OpenWebUiChannelMessageResponse> {
    return this.channelMessageCommands.pin(
      subject,
      channelId,
      messageId,
      isPinned,
    );
  }

  updateChannelMessage(
    subject: AuthSubject,
    channelId: string,
    messageId: string,
    input: OpenWebUiChannelMessageInput,
  ): Promise<OpenWebUiChannelMessageResponse> {
    return this.channelMessageCommands.update(
      subject,
      channelId,
      messageId,
      input,
    );
  }

  addChannelMessageReaction(
    subject: AuthSubject,
    channelId: string,
    messageId: string,
    name: string,
  ): Promise<boolean> {
    return this.channelMessageCommands.addReaction(
      subject,
      channelId,
      messageId,
      name,
    );
  }

  removeChannelMessageReaction(
    subject: AuthSubject,
    channelId: string,
    messageId: string,
    name: string,
  ): Promise<boolean> {
    return this.channelMessageCommands.removeReaction(
      subject,
      channelId,
      messageId,
      name,
    );
  }

  deleteChannelMessage(
    subject: AuthSubject,
    channelId: string,
    messageId: string,
  ): Promise<boolean> {
    return this.channelMessageCommands.delete(subject, channelId, messageId);
  }

  updateChannelMemberActiveStatus(
    subject: AuthSubject,
    channelId: string,
    isActive: boolean,
  ): Promise<boolean> {
    return this.channelCommands.updateMemberActiveStatus(
      subject,
      channelId,
      isActive,
    );
  }

  addChannelMembers(
    subject: AuthSubject,
    channelId: string,
    input: {
      user_ids?: string[] | undefined;
      group_ids?: string[] | undefined;
    },
  ): Promise<OpenWebUiChannelMemberResponse[]> {
    return this.channelCommands.addMembers(subject, channelId, input);
  }

  removeChannelMembers(
    subject: AuthSubject,
    channelId: string,
    input: { user_ids?: string[] | undefined },
  ): Promise<number> {
    return this.channelCommands.removeMembers(subject, channelId, input);
  }

  updateChannel(
    subject: AuthSubject,
    channelId: string,
    input: OpenWebUiChannelInput,
  ): Promise<OpenWebUiChannelResponse> {
    return this.channelCommands.update(subject, channelId, input);
  }

  deleteChannel(subject: AuthSubject, channelId: string): Promise<boolean> {
    return this.channelCommands.delete(subject, channelId);
  }
}

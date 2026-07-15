import { createHash } from "node:crypto";

import {
  assertScope,
  AuthorizationError,
  canAccessOrg,
  hasWorkspaceAccess,
  type AuthSubject,
} from "@romeo/auth";

import type {
  CollaborationChannel,
  CollaborationChannelMember,
  User,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { writeAuditLog } from "./audit-log";
import type {
  OpenWebUiChannelEvent,
  OpenWebUiChannelEventDataType,
  OpenWebUiChannelInput,
  OpenWebUiChannelListItemResponse,
  OpenWebUiChannelMemberResponse,
  OpenWebUiChannelMessageInput,
  OpenWebUiChannelMessageResponse,
  OpenWebUiChannelResponse,
  OpenWebUiChannelUserResponse,
  OpenWebUiCompatibilityService,
} from "./openwebui-compatibility-service";
import { assertWorkspaceActive } from "./workspace-guard";

export type ChannelType = "dm" | "group" | "standard";

export interface ChannelUser {
  id: string;
  email: string;
  name: string;
  disabled: boolean;
}

export interface Channel {
  id: string;
  type: ChannelType;
  name: string;
  ownerUserId: string;
  private: boolean;
  createdAt: string;
  updatedAt: string;
  unreadCount: number;
  archivedAt?: string;
  canWrite?: boolean;
  deletedAt?: string;
  description?: string;
  isManager?: boolean;
  lastMessageAt?: string;
  lastReadAt?: string;
  memberCount?: number;
  memberUserIds?: string[];
  members?: ChannelUser[];
}

export interface ChannelMember {
  id: string;
  channelId: string;
  userId: string;
  active: boolean;
  muted: boolean;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  invitedAt?: string;
  invitedBy?: string;
  joinedAt?: string;
  lastReadAt?: string;
  leftAt?: string;
  role?: string;
  status?: string;
  user?: ChannelUser;
}

export interface ChannelMessageReaction {
  name: string;
  userId: string;
}

export interface ChannelMessage {
  id: string;
  channelId: string;
  authorUserId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  pinned: boolean;
  reactions: ChannelMessageReaction[];
  replyCount: number;
  author?: ChannelUser;
  latestReplyAt?: string;
  parentMessageId?: string;
  pinnedAt?: string;
  pinnedBy?: string;
  replyToMessage?: ChannelMessage;
  replyToMessageId?: string;
}

export interface ChannelEvent {
  id: string;
  channelId: string;
  createdAt: string;
  type: OpenWebUiChannelEventDataType;
  actor?: ChannelUser;
  channel?: Channel;
  data?: unknown;
  messageId?: string;
}

export interface ChannelEventSubscription {
  connectedEvent: ChannelEvent;
  unsubscribe: () => void;
}

export interface CreateChannelInput {
  name: string;
  description?: string | null | undefined;
  groupIds?: string[] | undefined;
  private?: boolean | undefined;
  type?: ChannelType | undefined;
  userIds?: string[] | undefined;
  workspaceId?: string | undefined;
}

export interface UpdateChannelInput {
  description?: string | null | undefined;
  groupIds?: string[] | undefined;
  name?: string | undefined;
  private?: boolean | undefined;
  userIds?: string[] | undefined;
}

export interface AddChannelMembersInput {
  groupIds?: string[] | undefined;
  userIds?: string[] | undefined;
}

export interface CreateDirectMessageChannelInput {
  userId: string;
}

export interface CreateChannelMessageInput {
  content: string;
  clientMessageId?: string | undefined;
  parentMessageId?: string | undefined;
  replyToMessageId?: string | undefined;
}

export interface PinChannelMessageInput {
  pinned: boolean;
}

export interface RemoveChannelMemberResult {
  channelId: string;
  userId: string;
  removed: boolean;
}

export class ChannelService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly bridge: OpenWebUiCompatibilityService,
  ) {}

  async list(subject: AuthSubject): Promise<Channel[]> {
    return (await this.bridge.channels(subject)).map(toChannel);
  }

  async create(
    subject: AuthSubject,
    input: CreateChannelInput,
  ): Promise<Channel> {
    assertScope(subject, "chats:write");
    this.assertUserSubject(subject);
    const type = input.type ?? "group";
    if (type === "standard" && subject.isAdmin !== true) {
      throw new AuthorizationError("Only admins can create standard channels.");
    }
    const workspaceId = input.workspaceId ?? this.defaultWorkspaceId(subject);
    if (!hasWorkspaceAccess(subject, workspaceId)) {
      throw new AuthorizationError(
        "The workspace is outside the caller access.",
      );
    }
    await assertWorkspaceActive(this.repository, {
      orgId: subject.orgId,
      workspaceId,
    });
    const name = normalizeChannelName(input.name, type);
    const memberUserIds = await this.channelMemberUserIds(subject, {
      groupIds: input.groupIds,
      includeSubject: true,
      requireDmPeer: type === "dm",
      userIds: input.userIds,
    });
    if (type === "dm") {
      const existing = await this.findDirectMessage(subject, memberUserIds);
      if (existing !== undefined) {
        return this.get(subject, existing.id);
      }
    }

    const now = new Date().toISOString();
    const channel = await this.repository.transaction(async (repository) => {
      const created = await repository.createCollaborationChannel({
        id: createId("channel"),
        orgId: subject.orgId,
        workspaceId,
        userId: subject.id,
        ...(type === "standard" ? {} : { type }),
        name,
        ...(input.description === undefined || input.description === null
          ? {}
          : { description: input.description.trim() }),
        isPrivate: input.private ?? type === "dm",
        createdAt: now,
        updatedAt: now,
      });
      await Promise.all(
        memberUserIds.map((userId) =>
          repository.createCollaborationChannelMember(
            channelMemberDraft({
              channelId: created.id,
              invitedBy: subject.id,
              now,
              orgId: subject.orgId,
              role: userId === subject.id ? "manager" : undefined,
              userId,
            }),
          ),
        ),
      );
      await this.audit(
        subject,
        "channel.create",
        created.id,
        {
          memberCount: memberUserIds.length,
          private: input.private ?? type === "dm",
          type,
          workspaceId,
        },
        repository,
      );
      return created;
    });
    return this.get(subject, channel.id);
  }

  async directMessage(
    subject: AuthSubject,
    input: CreateDirectMessageChannelInput,
  ): Promise<Channel> {
    assertScope(subject, "chats:write");
    this.assertUserSubject(subject);
    if (input.userId === subject.id) {
      throw new ApiError(
        "invalid_channel_member",
        "A direct-message channel requires another user.",
        400,
      );
    }
    return this.create(subject, {
      name: "",
      private: true,
      type: "dm",
      userIds: [input.userId],
    });
  }

  async get(subject: AuthSubject, channelId: string): Promise<Channel> {
    return toChannel(await this.bridge.channel(subject, channelId));
  }

  async update(
    subject: AuthSubject,
    channelId: string,
    input: UpdateChannelInput,
  ): Promise<Channel> {
    assertScope(subject, "chats:write");
    this.assertUserSubject(subject);
    const channel = await this.authorizedChannel(subject, channelId, "write");
    const type = nativeChannelType(channel.type);
    const next: CollaborationChannel = {
      ...channel,
      updatedAt: new Date().toISOString(),
      updatedBy: subject.id,
    };
    if (input.name !== undefined) {
      next.name = normalizeChannelName(input.name, type);
    }
    if (input.description !== undefined) {
      if (input.description === null) delete next.description;
      else next.description = input.description.trim();
    }
    if (input.private !== undefined) next.isPrivate = input.private;
    await this.repository.transaction(async (repository) => {
      await repository.updateCollaborationChannel(next);
      const addedMembers = await this.addMembersToAuthorizedChannel({
        channel: next,
        groupIds: input.groupIds,
        repository,
        subject,
        userIds: input.userIds,
      });
      await this.audit(
        subject,
        "channel.update",
        channel.id,
        {
          addedMemberCount: addedMembers.length,
          changedDescription: input.description !== undefined,
          changedName: input.name !== undefined,
          changedPrivacy: input.private !== undefined,
          type,
        },
        repository,
      );
    });
    return this.get(subject, channel.id);
  }

  async delete(subject: AuthSubject, channelId: string): Promise<Channel> {
    assertScope(subject, "chats:write");
    this.assertUserSubject(subject);
    const channel = await this.authorizedChannel(subject, channelId, "write");
    const snapshot = toChannel(await this.bridge.channel(subject, channel.id));
    await this.repository.transaction(async (repository) => {
      await repository.deleteCollaborationChannel(channel.id);
      await this.audit(
        subject,
        "channel.delete",
        channel.id,
        {
          type: nativeChannelType(channel.type),
        },
        repository,
      );
    });
    return snapshot;
  }

  async members(
    subject: AuthSubject,
    channelId: string,
  ): Promise<ChannelMember[]> {
    const channel = await this.authorizedChannel(subject, channelId, "read");
    const [members, users] = await Promise.all([
      this.repository.listCollaborationChannelMembers(
        subject.orgId,
        channel.id,
      ),
      this.repository.listUsers(subject.orgId),
    ]);
    const userById = new Map(users.map((user) => [user.id, user]));
    return members
      .filter((member) => member.isActive)
      .map((member) => toChannelMember(member, userById.get(member.userId)));
  }

  async addMembers(
    subject: AuthSubject,
    channelId: string,
    input: AddChannelMembersInput,
  ): Promise<ChannelMember[]> {
    assertScope(subject, "chats:write");
    this.assertUserSubject(subject);
    const channel = await this.authorizedChannel(subject, channelId, "write");
    return this.repository.transaction(async (repository) => {
      const members = await this.addMembersToAuthorizedChannel({
        channel,
        groupIds: input.groupIds,
        repository,
        subject,
        userIds: input.userIds,
      });
      await this.audit(
        subject,
        "channel.members.add",
        channel.id,
        {
          addedMemberCount: members.length,
        },
        repository,
      );
      return members;
    });
  }

  async removeMember(
    subject: AuthSubject,
    channelId: string,
    userId: string,
  ): Promise<RemoveChannelMemberResult> {
    assertScope(subject, "chats:write");
    this.assertUserSubject(subject);
    const channel = await this.authorizedChannel(subject, channelId, "write");
    if (userId === subject.id) {
      throw new ApiError(
        "invalid_channel_member",
        "Use the leave-channel endpoint for the caller's own membership.",
        400,
      );
    }
    return this.repository.transaction(async (repository) => {
      const deleted = await repository.deleteCollaborationChannelMembers(
        channel.id,
        [userId],
      );
      await this.audit(
        subject,
        "channel.members.remove",
        channel.id,
        {
          removedMemberCount: deleted.length,
        },
        repository,
      );
      return { channelId: channel.id, userId, removed: deleted.length > 0 };
    });
  }

  async messages(
    subject: AuthSubject,
    channelId: string,
    input: { limit?: number | undefined; offset?: number | undefined } = {},
  ): Promise<ChannelMessage[]> {
    return (
      await this.bridge.channelMessages(subject, channelId, {
        limit: input.limit,
        skip: input.offset,
      })
    ).map(toChannelMessage);
  }

  async postMessage(
    subject: AuthSubject,
    channelId: string,
    input: CreateChannelMessageInput,
  ): Promise<ChannelMessage> {
    const message = await this.bridge.postChannelMessage(
      subject,
      channelId,
      toBridgeMessageInput(input),
    );
    await this.audit(subject, "channel.message.create", channelId, {
      messageId: message.id,
      parentMessagePresent: input.parentMessageId !== undefined,
      replyToMessagePresent: input.replyToMessageId !== undefined,
    });
    return toChannelMessage(message);
  }

  async message(
    subject: AuthSubject,
    channelId: string,
    messageId: string,
  ): Promise<ChannelMessage> {
    return toChannelMessage(
      await this.bridge.channelMessage(subject, channelId, messageId),
    );
  }

  async threadMessages(
    subject: AuthSubject,
    channelId: string,
    messageId: string,
    input: { limit?: number | undefined; offset?: number | undefined } = {},
  ): Promise<ChannelMessage[]> {
    return (
      await this.bridge.channelThreadMessages(subject, channelId, messageId, {
        limit: input.limit,
        skip: input.offset,
      })
    ).map(toChannelMessage);
  }

  async pinnedMessages(
    subject: AuthSubject,
    channelId: string,
    input: { page?: number | undefined } = {},
  ): Promise<ChannelMessage[]> {
    return (
      await this.bridge.pinnedChannelMessages(subject, channelId, input)
    ).map(toChannelMessage);
  }

  async updateMessage(
    subject: AuthSubject,
    channelId: string,
    messageId: string,
    input: CreateChannelMessageInput,
  ): Promise<ChannelMessage> {
    const message = await this.bridge.updateChannelMessage(
      subject,
      channelId,
      messageId,
      toBridgeMessageInput(input),
    );
    await this.audit(subject, "channel.message.update", channelId, {
      messageId,
    });
    return toChannelMessage(message);
  }

  async deleteMessage(
    subject: AuthSubject,
    channelId: string,
    messageId: string,
  ): Promise<{ channelId: string; messageId: string; deleted: boolean }> {
    const deleted = await this.bridge.deleteChannelMessage(
      subject,
      channelId,
      messageId,
    );
    await this.audit(subject, "channel.message.delete", channelId, {
      deleted,
      messageId,
    });
    return { channelId, messageId, deleted };
  }

  async pinMessage(
    subject: AuthSubject,
    channelId: string,
    messageId: string,
    input: PinChannelMessageInput,
  ): Promise<ChannelMessage> {
    const message = await this.bridge.pinChannelMessage(
      subject,
      channelId,
      messageId,
      input.pinned,
    );
    await this.audit(subject, "channel.message.pin", channelId, {
      messageId,
      pinned: input.pinned,
    });
    return toChannelMessage(message);
  }

  async addReaction(
    subject: AuthSubject,
    channelId: string,
    messageId: string,
    name: string,
  ): Promise<ChannelMessage> {
    await this.bridge.addChannelMessageReaction(
      subject,
      channelId,
      messageId,
      name,
    );
    await this.audit(subject, "channel.message.reaction.add", channelId, {
      messageId,
      reactionNameHash: hashAuditValue(name),
    });
    return this.message(subject, channelId, messageId);
  }

  async removeReaction(
    subject: AuthSubject,
    channelId: string,
    messageId: string,
    name: string,
  ): Promise<ChannelMessage> {
    await this.bridge.removeChannelMessageReaction(
      subject,
      channelId,
      messageId,
      name,
    );
    await this.audit(subject, "channel.message.reaction.remove", channelId, {
      messageId,
      reactionNameHash: hashAuditValue(name),
    });
    return this.message(subject, channelId, messageId);
  }

  async markRead(subject: AuthSubject, channelId: string): Promise<Channel> {
    await this.bridge.markChannelRead(subject, channelId);
    await this.audit(subject, "channel.read", channelId, {});
    return this.get(subject, channelId);
  }

  async subscribeEvents(
    subject: AuthSubject,
    channelId: string,
    handler: (event: ChannelEvent) => void,
  ): Promise<ChannelEventSubscription> {
    const subscription = await this.bridge.subscribeChannelEvents(
      subject,
      channelId,
      (event) => handler(toChannelEvent(event)),
    );
    return {
      connectedEvent: toChannelEvent(subscription.connectedEvent),
      unsubscribe: subscription.unsubscribe,
    };
  }

  private async addMembersToAuthorizedChannel(input: {
    channel: CollaborationChannel;
    groupIds?: string[] | undefined;
    repository?: RomeoRepository | undefined;
    subject: AuthSubject;
    userIds?: string[] | undefined;
  }): Promise<ChannelMember[]> {
    const userIds = await this.channelMemberUserIds(input.subject, {
      groupIds: input.groupIds,
      includeSubject: false,
      requireDmPeer: false,
      userIds: input.userIds,
    });
    if (userIds.length === 0) return [];
    const now = new Date().toISOString();
    const createMembers = (repository: RomeoRepository) =>
      Promise.all(
        userIds.map((userId) =>
          repository.createCollaborationChannelMember(
            channelMemberDraft({
              channelId: input.channel.id,
              invitedBy: input.subject.id,
              now,
              orgId: input.subject.orgId,
              userId,
            }),
          ),
        ),
      );
    const created =
      input.repository === undefined
        ? await this.repository.transaction(createMembers)
        : await createMembers(input.repository);
    const users = await this.repository.listUsers(input.subject.orgId);
    const userById = new Map(users.map((user) => [user.id, user]));
    return created.map((member) =>
      toChannelMember(member, userById.get(member.userId)),
    );
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
    const type = nativeChannelType(channel.type);
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

  private async channelMemberUserIds(
    subject: AuthSubject,
    input: {
      groupIds?: string[] | undefined;
      includeSubject: boolean;
      requireDmPeer: boolean;
      userIds?: string[] | undefined;
    },
  ): Promise<string[]> {
    const requested = new Set(input.userIds ?? []);
    if (input.includeSubject) requested.add(subject.id);
    const groupIds = [...new Set(input.groupIds ?? [])];
    if (groupIds.length > 0) {
      const groups = await this.repository.listGroups(subject.orgId);
      const knownGroupIds = new Set(groups.map((group) => group.id));
      const invalidGroupIds = groupIds.filter(
        (groupId) => !knownGroupIds.has(groupId),
      );
      if (invalidGroupIds.length > 0) {
        throw new ApiError(
          "invalid_channel_group",
          "Channel groups must exist in the caller organization.",
          400,
          { groupIds: invalidGroupIds },
        );
      }
      for (const groupId of groupIds) {
        const memberships = await this.repository.listGroupMemberships(
          subject.orgId,
          groupId,
        );
        for (const membership of memberships) requested.add(membership.userId);
      }
    }
    if (input.requireDmPeer && requested.size < 2) {
      throw new ApiError(
        "invalid_channel_member",
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
        "invalid_channel_member",
        "Channel members must be active users in the caller organization.",
        400,
        { userIds: invalid },
      );
    }
    return [...requested].sort();
  }

  private async findDirectMessage(
    subject: AuthSubject,
    userIds: string[],
  ): Promise<CollaborationChannel | undefined> {
    const wanted = [...userIds].sort();
    const channels = (
      await this.repository.listCollaborationChannels(subject.orgId)
    )
      .filter((channel) => nativeChannelType(channel.type) === "dm")
      .filter((channel) => channel.deletedAt === undefined);
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

  private defaultWorkspaceId(subject: AuthSubject): string {
    const workspaceId = subject.workspaceIds[0];
    if (workspaceId === undefined) {
      throw new AuthorizationError("No workspace is available to the caller.");
    }
    return workspaceId;
  }

  private assertUserSubject(subject: AuthSubject): void {
    if (subject.type !== "user") {
      throw new AuthorizationError(
        "Channels are available only for user subjects.",
      );
    }
  }

  private async audit(
    subject: AuthSubject,
    action: string,
    channelId: string,
    metadata: Record<string, unknown>,
    repository: RomeoRepository = this.repository,
  ): Promise<void> {
    await writeAuditLog(repository, {
      subject,
      action,
      resourceType: "channel",
      resourceId: channelId,
      metadata,
    });
  }
}

function channelMemberDraft(input: {
  channelId: string;
  invitedBy: string;
  now: string;
  orgId: string;
  userId: string;
  role?: string | undefined;
}): CollaborationChannelMember {
  return {
    id: createId("channel_member"),
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

function normalizeChannelName(name: string, type: ChannelType): string {
  if (type === "dm" && name.trim().length === 0) return "";
  const normalized = name.trim().replace(/\s+/gu, " ");
  if (normalized.length === 0) {
    throw new ApiError(
      "invalid_channel",
      "Channel name must not be empty.",
      400,
    );
  }
  return normalized.slice(0, 128);
}

function nativeChannelType(type: string | null | undefined): ChannelType {
  if (type === undefined || type === null || type === "") return "standard";
  if (type === "group" || type === "dm") return type;
  return "standard";
}

function toBridgeMessageInput(
  input: CreateChannelMessageInput,
): OpenWebUiChannelMessageInput {
  return {
    content: input.content,
    ...(input.clientMessageId === undefined
      ? {}
      : { temp_id: input.clientMessageId }),
    ...(input.parentMessageId === undefined
      ? {}
      : { parent_id: input.parentMessageId }),
    ...(input.replyToMessageId === undefined
      ? {}
      : { reply_to_id: input.replyToMessageId }),
  };
}

function toChannel(
  source: OpenWebUiChannelListItemResponse | OpenWebUiChannelResponse,
): Channel {
  const channel: Channel = {
    id: source.id,
    type: nativeChannelType(source.type),
    name: source.name,
    ownerUserId: source.user_id,
    private: source.is_private === true,
    createdAt: requiredIsoFromEpoch(source.created_at),
    updatedAt: requiredIsoFromEpoch(source.updated_at),
    unreadCount: source.unread_count,
  };
  if ("write_access" in source) channel.canWrite = source.write_access;
  if ("is_manager" in source) channel.isManager = source.is_manager;
  if (source.description !== null) channel.description = source.description;
  if (source.archived_at !== null) {
    channel.archivedAt = requiredIsoFromEpoch(source.archived_at);
  }
  if (source.deleted_at !== null) {
    channel.deletedAt = requiredIsoFromEpoch(source.deleted_at);
  }
  if (source.last_message_at !== null) {
    channel.lastMessageAt = requiredIsoFromEpoch(source.last_message_at);
  }
  if ("last_read_at" in source && source.last_read_at !== null) {
    channel.lastReadAt = requiredIsoFromEpoch(source.last_read_at);
  }
  if ("user_count" in source && source.user_count !== null) {
    channel.memberCount = source.user_count;
  }
  if (source.user_ids !== undefined) channel.memberUserIds = source.user_ids;
  if (source.users !== undefined)
    channel.members = source.users.map(toChannelUser);
  return channel;
}

function toChannelUser(
  source: OpenWebUiChannelUserResponse | User,
): ChannelUser {
  if ("is_active" in source) {
    return {
      id: source.id,
      email: source.email,
      name: source.name,
      disabled: !source.is_active,
    };
  }
  return {
    id: source.id,
    email: source.email,
    name: source.name,
    disabled: source.disabledAt !== undefined,
  };
}

function toChannelMember(
  source: CollaborationChannelMember | OpenWebUiChannelMemberResponse,
  user?: User,
): ChannelMember {
  if ("channel_id" in source) {
    const member: ChannelMember = {
      id: source.id,
      channelId: source.channel_id,
      userId: source.user_id,
      active: source.is_active,
      muted: source.is_channel_muted,
      pinned: source.is_channel_pinned,
      createdAt: requiredIsoFromEpoch(source.created_at),
      updatedAt: requiredIsoFromEpoch(source.updated_at),
    };
    assignOptionalMemberFields(member, {
      invitedAt: isoFromEpoch(source.invited_at),
      invitedBy: source.invited_by ?? undefined,
      joinedAt: isoFromEpoch(source.joined_at),
      lastReadAt: isoFromEpoch(source.last_read_at),
      leftAt: isoFromEpoch(source.left_at),
      role: source.role ?? undefined,
      status: source.status ?? undefined,
      user,
    });
    return member;
  }
  const member: ChannelMember = {
    id: source.id,
    channelId: source.channelId,
    userId: source.userId,
    active: source.isActive,
    muted: source.isChannelMuted,
    pinned: source.isChannelPinned,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
  assignOptionalMemberFields(member, {
    invitedAt: source.invitedAt,
    invitedBy: source.invitedBy,
    joinedAt: source.joinedAt,
    lastReadAt: source.lastReadAt,
    leftAt: source.leftAt,
    role: source.role,
    status: source.status,
    user,
  });
  return member;
}

function assignOptionalMemberFields(
  member: ChannelMember,
  input: {
    invitedAt?: string | undefined;
    invitedBy?: string | undefined;
    joinedAt?: string | undefined;
    lastReadAt?: string | undefined;
    leftAt?: string | undefined;
    role?: string | undefined;
    status?: string | undefined;
    user?: User | undefined;
  },
): void {
  if (input.invitedAt !== undefined) member.invitedAt = input.invitedAt;
  if (input.invitedBy !== undefined) member.invitedBy = input.invitedBy;
  if (input.joinedAt !== undefined) member.joinedAt = input.joinedAt;
  if (input.lastReadAt !== undefined) member.lastReadAt = input.lastReadAt;
  if (input.leftAt !== undefined) member.leftAt = input.leftAt;
  if (input.role !== undefined) member.role = input.role;
  if (input.status !== undefined) member.status = input.status;
  if (input.user !== undefined) member.user = toChannelUser(input.user);
}

function toChannelMessage(
  source: OpenWebUiChannelMessageResponse,
): ChannelMessage {
  const message: ChannelMessage = {
    id: source.id,
    channelId: source.channel_id,
    authorUserId: source.user_id,
    content: source.content,
    createdAt: requiredIsoFromEpoch(source.created_at),
    updatedAt: requiredIsoFromEpoch(source.updated_at),
    pinned: source.is_pinned,
    reactions: toChannelReactions(source.reactions),
    replyCount: source.reply_count,
  };
  if (source.user !== null) message.author = toChannelUser(source.user);
  if (source.parent_id !== null) message.parentMessageId = source.parent_id;
  if (source.reply_to_id !== null)
    message.replyToMessageId = source.reply_to_id;
  if (source.reply_to_message !== null) {
    message.replyToMessage = toChannelMessage(source.reply_to_message);
  }
  if (source.latest_reply_at !== null) {
    message.latestReplyAt = requiredIsoFromEpoch(source.latest_reply_at);
  }
  if (source.pinned_by !== null) message.pinnedBy = source.pinned_by;
  if (source.pinned_at !== null) {
    message.pinnedAt = requiredIsoFromEpoch(source.pinned_at);
  }
  return message;
}

function toChannelReactions(reactions: unknown[]): ChannelMessageReaction[] {
  return reactions
    .map((reaction) => {
      if (
        typeof reaction !== "object" ||
        reaction === null ||
        !("name" in reaction) ||
        !("user_id" in reaction)
      ) {
        return undefined;
      }
      const value = reaction as { name: unknown; user_id: unknown };
      if (typeof value.name !== "string" || typeof value.user_id !== "string") {
        return undefined;
      }
      return { name: value.name, userId: value.user_id };
    })
    .filter(
      (reaction): reaction is ChannelMessageReaction => reaction !== undefined,
    );
}

function toChannelEvent(source: OpenWebUiChannelEvent): ChannelEvent {
  const event: ChannelEvent = {
    id: source.id,
    channelId: source.channel_id,
    createdAt: requiredIsoFromEpoch(source.created_at),
    type: source.data.type,
  };
  if (source.message_id !== null) event.messageId = source.message_id;
  if (source.user !== null) event.actor = toChannelUser(source.user);
  if (source.channel !== null) event.channel = toChannel(source.channel);
  const data = toChannelEventData(source.data.data);
  if (data !== undefined) event.data = data;
  return event;
}

function toChannelEventData(data: unknown): unknown {
  if (
    typeof data === "object" &&
    data !== null &&
    "channel_id" in data &&
    "content" in data &&
    "created_at" in data
  ) {
    return toChannelMessage(data as OpenWebUiChannelMessageResponse);
  }
  if (
    typeof data === "object" &&
    data !== null &&
    "user_id" in data &&
    "last_read_at" in data
  ) {
    const value = data as { last_read_at: unknown; user_id: unknown };
    return {
      userId: typeof value.user_id === "string" ? value.user_id : undefined,
      lastReadAt:
        typeof value.last_read_at === "number"
          ? requiredIsoFromEpoch(value.last_read_at)
          : undefined,
    };
  }
  return data;
}

function requiredIsoFromEpoch(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString();
}

function isoFromEpoch(epochSeconds: number | null): string | undefined {
  return epochSeconds === null ? undefined : requiredIsoFromEpoch(epochSeconds);
}

function hashAuditValue(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

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
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import {
  channelMemberDraft,
  nativeChannelType,
  normalizeChannelName,
  toChannel,
  toChannelMember,
} from "./channel-mappers";
import { ChannelMessageService } from "./channel-message-service";
import type {
  AddChannelMembersInput,
  Channel,
  ChannelMember,
  CreateChannelInput,
  CreateDirectMessageChannelInput,
  RemoveChannelMemberResult,
  UpdateChannelInput,
} from "./channel-types";
import { assertWorkspaceActive } from "./workspace-guard";

export * from "./channel-types";

export class ChannelService extends ChannelMessageService {
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
      const requestedGroupIds = new Set(groupIds);
      const memberships = await this.repository.listGroupMemberships(
        subject.orgId,
      );
      for (const membership of memberships) {
        if (requestedGroupIds.has(membership.groupId)) {
          requested.add(membership.userId);
        }
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
    const [allChannels, allMembers] = await Promise.all([
      this.repository.listCollaborationChannels(subject.orgId),
      this.repository.listCollaborationChannelMembers(subject.orgId),
    ]);
    const channels = allChannels
      .filter((channel) => nativeChannelType(channel.type) === "dm")
      .filter((channel) => channel.deletedAt === undefined);
    const membersByChannel = new Map<string, string[]>();
    for (const member of allMembers) {
      const members = membersByChannel.get(member.channelId) ?? [];
      members.push(member.userId);
      membersByChannel.set(member.channelId, members);
    }
    for (const channel of channels) {
      const memberIds = (membersByChannel.get(channel.id) ?? []).sort();
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
}

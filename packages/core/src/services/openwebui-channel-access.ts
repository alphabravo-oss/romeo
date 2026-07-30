import {
  AuthorizationError,
  canAccessOrg,
  hasWorkspaceAccess,
  type AuthSubject,
} from "@romeo/auth";
import type { OpenWebUiChannelInput } from "@romeo/contracts";

import type {
  CollaborationChannel,
  CollaborationChannelMember,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import {
  channelBackingChatId,
  channelMessageMetadataFromParts,
  normalizeChannelType,
  type OpenWebUiChannelMessageRecord,
} from "./openwebui-channel-metadata";

export class OpenWebUiChannelAccess {
  constructor(private readonly repository: RomeoRepository) {}

  async authorizedChannel(
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

  canReadChannel(
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

  canWriteChannel(
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

  canPostChannelMessage(
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

  canPinChannelMessage(
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

  canMutateChannelMessage(
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

  async authorizedChannelMessage(
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

  async channelMessageRecords(
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

  async channelMemberUserIds(
    subject: AuthSubject,
    input: Pick<OpenWebUiChannelInput, "group_ids" | "name" | "user_ids">,
    type: string | undefined,
  ): Promise<string[]> {
    const requested = new Set<string>(input.user_ids ?? []);
    requested.add(subject.id);
    const requestedGroupIds = new Set(input.group_ids ?? []);
    if (requestedGroupIds.size > 0) {
      const memberships = await this.repository.listGroupMemberships(
        subject.orgId,
      );
      for (const membership of memberships) {
        if (requestedGroupIds.has(membership.groupId)) {
          requested.add(membership.userId);
        }
      }
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

  async findDmChannel(
    subject: AuthSubject,
    userIds: string[],
  ): Promise<CollaborationChannel | undefined> {
    const [allChannels, allMembers] = await Promise.all([
      this.repository.listCollaborationChannels(subject.orgId),
      this.repository.listCollaborationChannelMembers(subject.orgId),
    ]);
    const channels = allChannels
      .filter((channel) => normalizeChannelType(channel.type) === "dm")
      .filter((channel) => channel.deletedAt === undefined);
    const wanted = [...userIds].sort();
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

  async reactivateChannelMember(
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

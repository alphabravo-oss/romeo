import {
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
import { notFound } from "../errors";
import {
  channelBackingChatId,
  channelMessageMetadataFromParts,
  normalizeChannelType,
  type ChannelMessageRecord,
} from "./channel-metadata";

export class ChannelAccess {
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
    record: ChannelMessageRecord,
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
    record: ChannelMessageRecord;
    records: ChannelMessageRecord[];
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
  ): Promise<ChannelMessageRecord[]> {
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
      .filter((record): record is ChannelMessageRecord => record !== undefined);
  }
}

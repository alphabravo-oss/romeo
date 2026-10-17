import {
  AuthorizationError,
  assertScope,
  hasWorkspaceAccess,
  type AuthSubject,
} from "@romeo/auth";

import type { RomeoRepository } from "../domain/repository";
import type {
  ChannelStoreListItem,
  ChannelStoreChannel,
} from "./channel-store-types";
import type { ChannelAccess } from "./channel-access";
import { toChannelListItem, toChannelResponse } from "./channel-responses";

export class ChannelQueries {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly access: ChannelAccess,
  ) {}

  async list(subject: AuthSubject): Promise<ChannelStoreListItem[]> {
    assertReadSubject(subject);
    const [channels, memberships, users] = await Promise.all([
      this.repository.listCollaborationChannels(subject.orgId),
      this.repository.listCollaborationChannelMembers(subject.orgId),
      this.repository.listUsers(subject.orgId),
    ]);
    const userById = new Map(users.map((user) => [user.id, user]));
    const readableChannels = channels
      .filter((channel) =>
        this.access.canReadChannel(subject, channel, memberships),
      )
      .filter((channel) => channel.deletedAt === undefined)
      .filter((channel) => channel.archivedAt === undefined)
      .filter((channel) => hasWorkspaceAccess(subject, channel.workspaceId));
    return Promise.all(
      readableChannels.map(async (channel) => {
        const messageRecords = await this.access.channelMessageRecords(channel);
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

  async get(
    subject: AuthSubject,
    channelId: string,
  ): Promise<ChannelStoreChannel> {
    assertReadSubject(subject);
    const channel = await this.access.authorizedChannel(
      subject,
      channelId,
      "read",
    );
    const [members, users, messageRecords] = await Promise.all([
      this.repository.listCollaborationChannelMembers(
        subject.orgId,
        channel.id,
      ),
      this.repository.listUsers(subject.orgId),
      this.access.channelMessageRecords(channel),
    ]);
    return toChannelResponse(
      channel,
      subject,
      members,
      new Map(users.map((user) => [user.id, user])),
      this.access.canWriteChannel(subject, channel, members),
      messageRecords,
    );
  }
}

function assertReadSubject(subject: AuthSubject): void {
  assertScope(subject, "chats:read");
  if (subject.type !== "user") {
    throw new AuthorizationError(
      "Channels are available only for user subjects.",
    );
  }
}

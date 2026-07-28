import {
  AuthorizationError,
  assertScope,
  hasWorkspaceAccess,
  type AuthSubject,
} from "@romeo/auth";
import type {
  OpenWebUiChannelListItemResponse,
  OpenWebUiChannelMembersResponse,
  OpenWebUiChannelResponse,
} from "@romeo/contracts";

import type { User } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import type { OpenWebUiChannelAccess } from "./openwebui-channel-access";
import {
  toChannelListItem,
  toChannelResponse,
  toChannelUserResponse,
} from "./openwebui-channel-responses";

export class OpenWebUiChannelQueries {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly access: OpenWebUiChannelAccess,
  ) {}

  async list(
    subject: AuthSubject,
  ): Promise<OpenWebUiChannelListItemResponse[]> {
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
  ): Promise<OpenWebUiChannelResponse> {
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

  async members(
    subject: AuthSubject,
    channelId: string,
  ): Promise<OpenWebUiChannelMembersResponse> {
    assertReadSubject(subject);
    const channel = await this.access.authorizedChannel(
      subject,
      channelId,
      "read",
    );
    const [members, users] = await Promise.all([
      this.repository.listCollaborationChannelMembers(
        subject.orgId,
        channel.id,
      ),
      this.repository.listUsers(subject.orgId),
    ]);
    const userById = new Map(users.map((user) => [user.id, user]));
    const responseUsers = members
      .filter((member) => member.isActive)
      .map((member) => userById.get(member.userId))
      .filter((user): user is User => user !== undefined)
      .map(toChannelUserResponse);
    return { users: responseUsers, total: responseUsers.length };
  }
}

function assertReadSubject(subject: AuthSubject): void {
  assertScope(subject, "chats:read");
  if (subject.type !== "user") {
    throw new AuthorizationError(
      "OpenWebUI chat compatibility is available only for user subjects.",
    );
  }
}

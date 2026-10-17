import { AuthorizationError, assertScope, type AuthSubject } from "@romeo/auth";

import type { RomeoRepository } from "../domain/repository";
import type { ChannelStoreMessage } from "./channel-store-types";
import type { ChannelAccess } from "./channel-access";
import {
  boundedLimit,
  boundedOffset,
  boundedPage,
  compareIsoDesc,
} from "./channel-metadata";
import { toChannelMessageResponse } from "./channel-responses";

export class ChannelMessageQueries {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly access: ChannelAccess,
  ) {}

  async list(
    subject: AuthSubject,
    channelId: string,
    input: { skip?: number | undefined; limit?: number | undefined } = {},
  ): Promise<ChannelStoreMessage[]> {
    assertReadSubject(subject);
    const channel = await this.access.authorizedChannel(
      subject,
      channelId,
      "read",
    );
    const [records, users] = await Promise.all([
      this.access.channelMessageRecords(channel),
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

  async pinned(
    subject: AuthSubject,
    channelId: string,
    input: { page?: number | undefined } = {},
  ): Promise<ChannelStoreMessage[]> {
    assertReadSubject(subject);
    const channel = await this.access.authorizedChannel(
      subject,
      channelId,
      "read",
    );
    const [records, users] = await Promise.all([
      this.access.channelMessageRecords(channel),
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

  async get(
    subject: AuthSubject,
    channelId: string,
    messageId: string,
  ): Promise<ChannelStoreMessage> {
    assertReadSubject(subject);
    const { record, records } = await this.access.authorizedChannelMessage(
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

  async thread(
    subject: AuthSubject,
    channelId: string,
    messageId: string,
    input: { skip?: number | undefined; limit?: number | undefined } = {},
  ): Promise<ChannelStoreMessage[]> {
    assertReadSubject(subject);
    const { records } = await this.access.authorizedChannelMessage(
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
}

function assertReadSubject(subject: AuthSubject): void {
  assertScope(subject, "chats:read");
  if (subject.type !== "user") {
    throw new AuthorizationError(
      "Channels are available only for user subjects.",
    );
  }
}

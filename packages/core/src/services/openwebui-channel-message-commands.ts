import { AuthorizationError, assertScope, type AuthSubject } from "@romeo/auth";
import type {
  OpenWebUiChannelMessageInput,
  OpenWebUiChannelMessageResponse,
} from "@romeo/contracts";

import type { RomeoRepository } from "../domain/repository";
import { notFound } from "../errors";
import { createId } from "../ids";
import type { OpenWebUiChannelAccess } from "./openwebui-channel-access";
import type { OpenWebUiChannelEvents } from "./openwebui-channel-events";
import {
  appendChannelMessageMetadata,
  ensureChannelBackingChat,
  normalizeChannelMessageContent,
  normalizeReactionName,
  replaceChannelMessageRecord,
  type OpenWebUiChannelMessageMetadata,
} from "./openwebui-channel-metadata";
import { toChannelMessageResponse } from "./openwebui-channel-responses";
import { toEpochSeconds } from "./openwebui-compatibility-values";

export class OpenWebUiChannelMessageCommands {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly access: OpenWebUiChannelAccess,
    private readonly events: OpenWebUiChannelEvents,
  ) {}

  async post(
    subject: AuthSubject,
    channelId: string,
    input: OpenWebUiChannelMessageInput,
  ): Promise<OpenWebUiChannelMessageResponse> {
    assertWriteSubject(subject);
    const channel = await this.access.authorizedChannel(
      subject,
      channelId,
      "read",
    );
    const members = await this.repository.listCollaborationChannelMembers(
      subject.orgId,
      channel.id,
    );
    if (!this.access.canPostChannelMessage(subject, channel, members)) {
      throw new AuthorizationError(
        `Missing write permission for channel:${channel.id}`,
      );
    }
    const now = new Date().toISOString();
    const content = normalizeChannelMessageContent(input.content);
    const result = await this.repository.transaction(async (repository) => {
      const chat = await ensureChannelBackingChat(repository, channel, now);
      // Deliberately parentless: a channel's backing chat is a flat message log, never rendered by
      // the branch/variant UI, and its own threading lives in replyToId on the metadata part below.
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
    const records = await this.access.channelMessageRecords(channel);
    const mergedRecords = records.some(
      (record) => record.message.id === result.message.id,
    )
      ? records
      : [...records, result];
    const userById = new Map(users.map((user) => [user.id, user]));
    const response = toChannelMessageResponse(result, userById, mergedRecords);
    await this.events.publish(subject, channel, response.id, "message", {
      ...(input.temp_id === undefined ? {} : { temp_id: input.temp_id }),
      ...response,
    });
    if (response.parent_id !== null) {
      const parentRecord = mergedRecords.find(
        (record) => record.message.id === response.parent_id,
      );
      if (parentRecord !== undefined) {
        await this.events.publish(
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

  async markRead(subject: AuthSubject, channelId: string): Promise<boolean> {
    assertWriteSubject(subject);
    const channel = await this.access.authorizedChannel(
      subject,
      channelId,
      "read",
    );
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
    await this.events.publish(subject, channel, null, "last_read_at", {
      user_id: subject.id,
      last_read_at: toEpochSeconds(now),
    });
    return true;
  }

  async pin(
    subject: AuthSubject,
    channelId: string,
    messageId: string,
    isPinned: boolean,
  ): Promise<OpenWebUiChannelMessageResponse> {
    assertWriteSubject(subject);
    const { channel, record, records } =
      await this.access.authorizedChannelMessage(subject, channelId, messageId);
    const members = await this.repository.listCollaborationChannelMembers(
      subject.orgId,
      channel.id,
    );
    if (!this.access.canPinChannelMessage(subject, channel, members)) {
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
    return this.publishUpdatedMessage(
      subject,
      channel,
      record.message,
      metadata,
      records,
      "message:update",
    );
  }

  async update(
    subject: AuthSubject,
    channelId: string,
    messageId: string,
    input: OpenWebUiChannelMessageInput,
  ): Promise<OpenWebUiChannelMessageResponse> {
    assertWriteSubject(subject);
    const { channel, record, records } =
      await this.access.authorizedChannelMessage(subject, channelId, messageId);
    const members = await this.repository.listCollaborationChannelMembers(
      subject.orgId,
      channel.id,
    );
    if (
      !this.access.canMutateChannelMessage(subject, channel, members, record)
    ) {
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
    return this.publishUpdatedMessage(
      subject,
      channel,
      record.message,
      metadata,
      records,
      "message:update",
    );
  }

  addReaction(
    subject: AuthSubject,
    channelId: string,
    messageId: string,
    name: string,
  ): Promise<boolean> {
    return this.updateReaction(subject, channelId, messageId, name, "add");
  }

  removeReaction(
    subject: AuthSubject,
    channelId: string,
    messageId: string,
    name: string,
  ): Promise<boolean> {
    return this.updateReaction(subject, channelId, messageId, name, "remove");
  }

  async delete(
    subject: AuthSubject,
    channelId: string,
    messageId: string,
  ): Promise<boolean> {
    assertWriteSubject(subject);
    const { channel, record, records } =
      await this.access.authorizedChannelMessage(subject, channelId, messageId);
    const members = await this.repository.listCollaborationChannelMembers(
      subject.orgId,
      channel.id,
    );
    if (
      !this.access.canMutateChannelMessage(subject, channel, members, record)
    ) {
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
    await this.events.publish(
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
        await this.events.publish(
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

  private async updateReaction(
    subject: AuthSubject,
    channelId: string,
    messageId: string,
    name: string,
    action: "add" | "remove",
  ): Promise<boolean> {
    assertWriteSubject(subject);
    const { channel, record, records } =
      await this.access.authorizedChannelMessage(subject, channelId, messageId);
    const members = await this.repository.listCollaborationChannelMembers(
      subject.orgId,
      channel.id,
    );
    if (!this.access.canPinChannelMessage(subject, channel, members)) {
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
    const metadata: OpenWebUiChannelMessageMetadata = {
      ...record.metadata,
      updatedAt: new Date().toISOString(),
      reactions:
        action === "add"
          ? [...withoutCurrent, { userId: subject.id, name: reactionName }]
          : withoutCurrent,
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
    await this.events.publish(
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

  private async publishUpdatedMessage(
    subject: AuthSubject,
    channel: Parameters<OpenWebUiChannelEvents["publish"]>[1],
    message: Parameters<typeof toChannelMessageResponse>[0]["message"],
    metadata: OpenWebUiChannelMessageMetadata,
    records: Parameters<typeof toChannelMessageResponse>[2],
    eventType: "message:update",
  ): Promise<OpenWebUiChannelMessageResponse> {
    const users = await this.repository.listUsers(subject.orgId);
    const nextRecords = replaceChannelMessageRecord(
      records,
      message.id,
      metadata,
    );
    const response = toChannelMessageResponse(
      { message, metadata },
      new Map(users.map((user) => [user.id, user])),
      nextRecords,
    );
    await this.events.publish(
      subject,
      channel,
      message.id,
      eventType,
      response,
    );
    return response;
  }
}

function assertWriteSubject(subject: AuthSubject): void {
  assertScope(subject, "chats:write");
  if (subject.type !== "user") {
    throw new AuthorizationError(
      "OpenWebUI chat compatibility is available only for user subjects.",
    );
  }
}

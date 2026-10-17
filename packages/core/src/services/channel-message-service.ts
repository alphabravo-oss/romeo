import type { AuthSubject } from "@romeo/auth";

import type { RomeoRepository } from "../domain/repository";
import {
  type AuditAction,
  type AuditMetadata,
  writeAuditLog,
} from "./audit-log";
import type { ChannelStore } from "./channel-store";
import {
  hashAuditValue,
  toStoreMessageInput,
  toChannel,
  toChannelEvent,
  toChannelMessage,
} from "./channel-mappers";
import type {
  Channel,
  ChannelEvent,
  ChannelEventSubscription,
  ChannelMessage,
  CreateChannelMessageInput,
  PinChannelMessageInput,
} from "./channel-types";

export class ChannelMessageService {
  constructor(
    protected readonly repository: RomeoRepository,
    protected readonly store: ChannelStore,
  ) {}

  async list(subject: AuthSubject): Promise<Channel[]> {
    return (await this.store.channels(subject)).map(toChannel);
  }

  async get(subject: AuthSubject, channelId: string): Promise<Channel> {
    return toChannel(await this.store.channel(subject, channelId));
  }

  async messages(
    subject: AuthSubject,
    channelId: string,
    input: { limit?: number | undefined; offset?: number | undefined } = {},
  ): Promise<ChannelMessage[]> {
    return (
      await this.store.channelMessages(subject, channelId, {
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
    const message = await this.store.postChannelMessage(
      subject,
      channelId,
      toStoreMessageInput(input),
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
      await this.store.channelMessage(subject, channelId, messageId),
    );
  }

  async threadMessages(
    subject: AuthSubject,
    channelId: string,
    messageId: string,
    input: { limit?: number | undefined; offset?: number | undefined } = {},
  ): Promise<ChannelMessage[]> {
    return (
      await this.store.channelThreadMessages(subject, channelId, messageId, {
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
      await this.store.pinnedChannelMessages(subject, channelId, input)
    ).map(toChannelMessage);
  }

  async updateMessage(
    subject: AuthSubject,
    channelId: string,
    messageId: string,
    input: CreateChannelMessageInput,
  ): Promise<ChannelMessage> {
    const message = await this.store.updateChannelMessage(
      subject,
      channelId,
      messageId,
      toStoreMessageInput(input),
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
    const deleted = await this.store.deleteChannelMessage(
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
    const message = await this.store.pinChannelMessage(
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
    await this.store.addChannelMessageReaction(
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
    await this.store.removeChannelMessageReaction(
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
    await this.store.markChannelRead(subject, channelId);
    await this.audit(subject, "channel.read", channelId, {});
    return toChannel(await this.store.channel(subject, channelId));
  }

  async subscribeEvents(
    subject: AuthSubject,
    channelId: string,
    handler: (event: ChannelEvent) => void,
  ): Promise<ChannelEventSubscription> {
    const subscription = await this.store.subscribeChannelEvents(
      subject,
      channelId,
      (event) => handler(toChannelEvent(event)),
    );
    return {
      connectedEvent: toChannelEvent(subscription.connectedEvent),
      unsubscribe: subscription.unsubscribe,
    };
  }

  protected async audit<A extends AuditAction>(
    subject: AuthSubject,
    action: A,
    channelId: string,
    metadata: AuditMetadata<A>,
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

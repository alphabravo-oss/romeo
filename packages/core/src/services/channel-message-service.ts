import type { AuthSubject } from "@romeo/auth";

import type { RomeoRepository } from "../domain/repository";
import {
  type AuditAction,
  type AuditMetadata,
  writeAuditLog,
} from "./audit-log";
import type { OpenWebUiCompatibilityService } from "./openwebui-compatibility-service";
import {
  hashAuditValue,
  toBridgeMessageInput,
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
    protected readonly bridge: OpenWebUiCompatibilityService,
  ) {}

  async list(subject: AuthSubject): Promise<Channel[]> {
    return (await this.bridge.channels(subject)).map(toChannel);
  }

  async get(subject: AuthSubject, channelId: string): Promise<Channel> {
    return toChannel(await this.bridge.channel(subject, channelId));
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
    return toChannel(await this.bridge.channel(subject, channelId));
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

import type { AuthSubject } from "@romeo/auth";

import type { RomeoRepository } from "../domain/repository";
import { ChannelAccess } from "./channel-access";
import {
  ChannelEvents,
  type ChannelStoreEventSubscription,
} from "./channel-events";
import { ChannelMessageCommands } from "./channel-message-commands";
import { ChannelMessageQueries } from "./channel-message-queries";
import { ChannelQueries } from "./channel-queries";
import type {
  ChannelStoreChannel,
  ChannelStoreEvent,
  ChannelStoreListItem,
  ChannelStoreMessage,
  ChannelStoreMessageInput,
} from "./channel-store-types";
import { InMemoryRealtimeEventBus } from "./realtime-event-bus";

/**
 * Channel message storage, read models, and realtime events backing the
 * native collaboration channel API.
 */
export class ChannelStore {
  private readonly channelEventService: ChannelEvents;
  private readonly channelMessageQueries: ChannelMessageQueries;
  private readonly channelMessageCommands: ChannelMessageCommands;
  private readonly channelQueries: ChannelQueries;

  constructor(
    repository: RomeoRepository,
    channelEvents = new InMemoryRealtimeEventBus<ChannelStoreEvent>(),
  ) {
    const channelAccess = new ChannelAccess(repository);
    this.channelEventService = new ChannelEvents(
      repository,
      channelAccess,
      channelEvents,
    );
    this.channelMessageQueries = new ChannelMessageQueries(
      repository,
      channelAccess,
    );
    this.channelMessageCommands = new ChannelMessageCommands(
      repository,
      channelAccess,
      this.channelEventService,
    );
    this.channelQueries = new ChannelQueries(repository, channelAccess);
  }

  channels(subject: AuthSubject): Promise<ChannelStoreListItem[]> {
    return this.channelQueries.list(subject);
  }

  channel(
    subject: AuthSubject,
    channelId: string,
  ): Promise<ChannelStoreChannel> {
    return this.channelQueries.get(subject, channelId);
  }

  subscribeChannelEvents(
    subject: AuthSubject,
    channelId: string,
    handler: (event: ChannelStoreEvent) => void,
  ): Promise<ChannelStoreEventSubscription> {
    return this.channelEventService.subscribe(subject, channelId, handler);
  }

  channelMessages(
    subject: AuthSubject,
    channelId: string,
    input: { skip?: number | undefined; limit?: number | undefined } = {},
  ): Promise<ChannelStoreMessage[]> {
    return this.channelMessageQueries.list(subject, channelId, input);
  }

  postChannelMessage(
    subject: AuthSubject,
    channelId: string,
    input: ChannelStoreMessageInput,
  ): Promise<ChannelStoreMessage> {
    return this.channelMessageCommands.post(subject, channelId, input);
  }

  markChannelRead(subject: AuthSubject, channelId: string): Promise<boolean> {
    return this.channelMessageCommands.markRead(subject, channelId);
  }

  pinnedChannelMessages(
    subject: AuthSubject,
    channelId: string,
    input: { page?: number | undefined } = {},
  ): Promise<ChannelStoreMessage[]> {
    return this.channelMessageQueries.pinned(subject, channelId, input);
  }

  channelMessage(
    subject: AuthSubject,
    channelId: string,
    messageId: string,
  ): Promise<ChannelStoreMessage> {
    return this.channelMessageQueries.get(subject, channelId, messageId);
  }

  channelThreadMessages(
    subject: AuthSubject,
    channelId: string,
    messageId: string,
    input: { skip?: number | undefined; limit?: number | undefined } = {},
  ): Promise<ChannelStoreMessage[]> {
    return this.channelMessageQueries.thread(
      subject,
      channelId,
      messageId,
      input,
    );
  }

  pinChannelMessage(
    subject: AuthSubject,
    channelId: string,
    messageId: string,
    isPinned: boolean,
  ): Promise<ChannelStoreMessage> {
    return this.channelMessageCommands.pin(
      subject,
      channelId,
      messageId,
      isPinned,
    );
  }

  updateChannelMessage(
    subject: AuthSubject,
    channelId: string,
    messageId: string,
    input: ChannelStoreMessageInput,
  ): Promise<ChannelStoreMessage> {
    return this.channelMessageCommands.update(
      subject,
      channelId,
      messageId,
      input,
    );
  }

  addChannelMessageReaction(
    subject: AuthSubject,
    channelId: string,
    messageId: string,
    name: string,
  ): Promise<boolean> {
    return this.channelMessageCommands.addReaction(
      subject,
      channelId,
      messageId,
      name,
    );
  }

  removeChannelMessageReaction(
    subject: AuthSubject,
    channelId: string,
    messageId: string,
    name: string,
  ): Promise<boolean> {
    return this.channelMessageCommands.removeReaction(
      subject,
      channelId,
      messageId,
      name,
    );
  }

  deleteChannelMessage(
    subject: AuthSubject,
    channelId: string,
    messageId: string,
  ): Promise<boolean> {
    return this.channelMessageCommands.delete(subject, channelId, messageId);
  }
}

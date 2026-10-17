import { AuthorizationError, assertScope, type AuthSubject } from "@romeo/auth";

import type { CollaborationChannel } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { createId } from "../ids";
import type {
  ChannelStoreEvent,
  ChannelEventType,
} from "./channel-store-types";
import type { ChannelAccess } from "./channel-access";
import { channelEventBusKey } from "./channel-metadata";
import { toChannelResponse, toChannelUserResponse } from "./channel-responses";
import { toEpochSeconds } from "./channel-values";
import { InMemoryRealtimeEventBus } from "./realtime-event-bus";

export interface ChannelStoreEventSubscription {
  connectedEvent: ChannelStoreEvent;
  unsubscribe: () => void;
}

export class ChannelEvents {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly access: ChannelAccess,
    private readonly events: InMemoryRealtimeEventBus<ChannelStoreEvent>,
  ) {}

  async subscribe(
    subject: AuthSubject,
    channelId: string,
    handler: (event: ChannelStoreEvent) => void,
  ): Promise<ChannelStoreEventSubscription> {
    assertScope(subject, "chats:read");
    assertUserSubject(subject);
    const channel = await this.access.authorizedChannel(
      subject,
      channelId,
      "read",
    );
    return {
      connectedEvent: await this.toEvent(
        subject,
        channel,
        null,
        "channel:connected",
        { channel_id: channel.id },
      ),
      unsubscribe: this.events.subscribe(
        channelEventBusKey(subject.orgId, channel.id),
        handler,
      ),
    };
  }

  async publish(
    subject: AuthSubject,
    channel: CollaborationChannel,
    messageId: string | null,
    type: ChannelEventType,
    data: unknown,
  ): Promise<void> {
    this.events.publish(
      channelEventBusKey(subject.orgId, channel.id),
      await this.toEvent(subject, channel, messageId, type, data),
    );
  }

  private async toEvent(
    subject: AuthSubject,
    channel: CollaborationChannel,
    messageId: string | null,
    type: ChannelEventType,
    data: unknown,
  ): Promise<ChannelStoreEvent> {
    const [members, users, messageRecords] = await Promise.all([
      this.repository.listCollaborationChannelMembers(
        subject.orgId,
        channel.id,
      ),
      this.repository.listUsers(subject.orgId),
      this.access.channelMessageRecords(channel),
    ]);
    const userById = new Map(users.map((user) => [user.id, user]));
    const user = users.find((candidate) => candidate.id === subject.id);
    return {
      id: createId("channel_event"),
      channel_id: channel.id,
      message_id: messageId,
      created_at: toEpochSeconds(new Date().toISOString()),
      data: { type, data },
      user: user === undefined ? null : toChannelUserResponse(user),
      channel: toChannelResponse(
        channel,
        subject,
        members,
        userById,
        this.access.canWriteChannel(subject, channel, members),
        messageRecords,
      ),
    };
  }
}

function assertUserSubject(subject: AuthSubject): void {
  if (subject.type !== "user") {
    throw new AuthorizationError(
      "Channels are available only for user subjects.",
    );
  }
}

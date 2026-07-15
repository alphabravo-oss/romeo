import { pathId, withQuery } from "../path";
import type { ServerSentEvent } from "../sse";
import type { RomeoTransport } from "../transport";
import type {
  AddChannelMembersInput,
  Channel,
  ChannelMember,
  ChannelMemberRemovalResult,
  ChannelMessage,
  ChannelMessageDeletionResult,
  ChannelMessageQuery,
  CreateChannelInput,
  CreateChannelMessageInput,
  CreateDirectMessageChannelInput,
  PinChannelMessageInput,
  UpdateChannelInput,
} from "../types";

export function createChannelResource(transport: RomeoTransport) {
  return {
    list: () =>
      transport.data<Channel[]>("GET", "/api/v1/collaboration/channels"),
    create: (input: CreateChannelInput) =>
      transport.data<Channel>(
        "POST",
        "/api/v1/collaboration/channels",
        input,
      ),
    directMessage: (input: CreateDirectMessageChannelInput) =>
      transport.data<Channel>(
        "POST",
        "/api/v1/collaboration/channels/direct-messages",
        input,
      ),
    get: (channelId: string) =>
      transport.data<Channel>(
        "GET",
        `/api/v1/collaboration/channels/${pathId(channelId)}`,
      ),
    update: (channelId: string, input: UpdateChannelInput) =>
      transport.data<Channel>(
        "PATCH",
        `/api/v1/collaboration/channels/${pathId(channelId)}`,
        input,
      ),
    delete: (channelId: string) =>
      transport.data<Channel>(
        "DELETE",
        `/api/v1/collaboration/channels/${pathId(channelId)}`,
      ),
    events: (channelId: string): AsyncIterable<ServerSentEvent> =>
      transport.events(`/api/v1/collaboration/channels/${pathId(channelId)}/events`),
    members: (channelId: string) =>
      transport.data<ChannelMember[]>(
        "GET",
        `/api/v1/collaboration/channels/${pathId(channelId)}/members`,
      ),
    addMembers: (channelId: string, input: AddChannelMembersInput) =>
      transport.data<ChannelMember[]>(
        "POST",
        `/api/v1/collaboration/channels/${pathId(channelId)}/members`,
        input,
      ),
    removeMember: (channelId: string, userId: string) =>
      transport.data<ChannelMemberRemovalResult>(
        "DELETE",
        `/api/v1/collaboration/channels/${pathId(channelId)}/members/${pathId(
          userId,
        )}`,
      ),
    messages: (channelId: string, query: ChannelMessageQuery = {}) =>
      transport.data<ChannelMessage[]>(
        "GET",
        withQuery(`/api/v1/collaboration/channels/${pathId(channelId)}/messages`, {
          limit: query.limit,
          offset: query.offset,
        }),
      ),
    postMessage: (channelId: string, input: CreateChannelMessageInput) =>
      transport.data<ChannelMessage>(
        "POST",
        `/api/v1/collaboration/channels/${pathId(channelId)}/messages`,
        input,
      ),
    markRead: (channelId: string) =>
      transport.data<Channel>(
        "POST",
        `/api/v1/collaboration/channels/${pathId(channelId)}/read`,
      ),
    pinnedMessages: (channelId: string, page?: number) =>
      transport.data<ChannelMessage[]>(
        "GET",
        withQuery(
          `/api/v1/collaboration/channels/${pathId(channelId)}/messages/pinned`,
          { page },
        ),
      ),
    message: (channelId: string, messageId: string) =>
      transport.data<ChannelMessage>(
        "GET",
        `/api/v1/collaboration/channels/${pathId(channelId)}/messages/${pathId(
          messageId,
        )}`,
      ),
    updateMessage: (
      channelId: string,
      messageId: string,
      input: CreateChannelMessageInput,
    ) =>
      transport.data<ChannelMessage>(
        "PATCH",
        `/api/v1/collaboration/channels/${pathId(channelId)}/messages/${pathId(
          messageId,
        )}`,
        input,
      ),
    deleteMessage: (channelId: string, messageId: string) =>
      transport.data<ChannelMessageDeletionResult>(
        "DELETE",
        `/api/v1/collaboration/channels/${pathId(channelId)}/messages/${pathId(
          messageId,
        )}`,
      ),
    threadMessages: (
      channelId: string,
      messageId: string,
      query: ChannelMessageQuery = {},
    ) =>
      transport.data<ChannelMessage[]>(
        "GET",
        withQuery(
          `/api/v1/collaboration/channels/${pathId(channelId)}/messages/${pathId(
            messageId,
          )}/thread`,
          { limit: query.limit, offset: query.offset },
        ),
      ),
    pinMessage: (
      channelId: string,
      messageId: string,
      input: PinChannelMessageInput,
    ) =>
      transport.data<ChannelMessage>(
        "POST",
        `/api/v1/collaboration/channels/${pathId(channelId)}/messages/${pathId(
          messageId,
        )}/pin`,
        input,
      ),
    addReaction: (channelId: string, messageId: string, name: string) =>
      transport.data<ChannelMessage>(
        "POST",
        `/api/v1/collaboration/channels/${pathId(channelId)}/messages/${pathId(
          messageId,
        )}/reactions`,
        { name },
      ),
    removeReaction: (channelId: string, messageId: string, name: string) =>
      transport.data<ChannelMessage>(
        "DELETE",
        `/api/v1/collaboration/channels/${pathId(channelId)}/messages/${pathId(
          messageId,
        )}/reactions/${pathId(name)}`,
      ),
  };
}

import { createHash } from "node:crypto";

import type {
  OpenWebUiChannelEvent,
  OpenWebUiChannelInput,
  OpenWebUiChannelListItemResponse,
  OpenWebUiChannelMemberResponse,
  OpenWebUiChannelMessageInput,
  OpenWebUiChannelMessageResponse,
  OpenWebUiChannelResponse,
  OpenWebUiChannelUserResponse,
} from "@romeo/contracts";

import type { CollaborationChannelMember, User } from "../domain/entities";
import { ApiError } from "../errors";
import { createId } from "../ids";
import type {
  Channel,
  ChannelEvent,
  ChannelMember,
  ChannelMessage,
  ChannelMessageReaction,
  ChannelType,
  ChannelUser,
  CreateChannelMessageInput,
} from "./channel-types";

export function channelMemberDraft(input: {
  channelId: string;
  invitedBy: string;
  now: string;
  orgId: string;
  userId: string;
  role?: string | undefined;
}): CollaborationChannelMember {
  return {
    id: createId("channel_member"),
    orgId: input.orgId,
    channelId: input.channelId,
    userId: input.userId,
    ...(input.role === undefined ? {} : { role: input.role }),
    status: "joined",
    isActive: true,
    isChannelMuted: false,
    isChannelPinned: false,
    invitedAt: input.now,
    invitedBy: input.invitedBy,
    joinedAt: input.now,
    lastReadAt: input.now,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function normalizeChannelName(name: string, type: ChannelType): string {
  if (type === "dm" && name.trim().length === 0) return "";
  const normalized = name.trim().replace(/\s+/gu, " ");
  if (normalized.length === 0) {
    throw new ApiError(
      "invalid_channel",
      "Channel name must not be empty.",
      400,
    );
  }
  return normalized.slice(0, 128);
}

export function nativeChannelType(
  type: string | null | undefined,
): ChannelType {
  if (type === undefined || type === null || type === "") return "standard";
  if (type === "group" || type === "dm") return type;
  return "standard";
}

export function toBridgeMessageInput(
  input: CreateChannelMessageInput,
): OpenWebUiChannelMessageInput {
  return {
    content: input.content,
    ...(input.clientMessageId === undefined
      ? {}
      : { temp_id: input.clientMessageId }),
    ...(input.parentMessageId === undefined
      ? {}
      : { parent_id: input.parentMessageId }),
    ...(input.replyToMessageId === undefined
      ? {}
      : { reply_to_id: input.replyToMessageId }),
  };
}

export function toChannel(
  source: OpenWebUiChannelListItemResponse | OpenWebUiChannelResponse,
): Channel {
  const channel: Channel = {
    id: source.id,
    type: nativeChannelType(source.type),
    name: source.name,
    ownerUserId: source.user_id,
    private: source.is_private === true,
    createdAt: requiredIsoFromEpoch(source.created_at),
    updatedAt: requiredIsoFromEpoch(source.updated_at),
    unreadCount: source.unread_count,
  };
  if ("write_access" in source) channel.canWrite = source.write_access;
  if ("is_manager" in source) channel.isManager = source.is_manager;
  if (source.description !== null) channel.description = source.description;
  if (source.archived_at !== null) {
    channel.archivedAt = requiredIsoFromEpoch(source.archived_at);
  }
  if (source.deleted_at !== null) {
    channel.deletedAt = requiredIsoFromEpoch(source.deleted_at);
  }
  if (source.last_message_at !== null) {
    channel.lastMessageAt = requiredIsoFromEpoch(source.last_message_at);
  }
  if ("last_read_at" in source && source.last_read_at !== null) {
    channel.lastReadAt = requiredIsoFromEpoch(source.last_read_at);
  }
  if ("user_count" in source && source.user_count !== null) {
    channel.memberCount = source.user_count;
  }
  if (source.user_ids !== undefined) channel.memberUserIds = source.user_ids;
  if (source.users !== undefined)
    channel.members = source.users.map(toChannelUser);
  return channel;
}

function toChannelUser(
  source: OpenWebUiChannelUserResponse | User,
): ChannelUser {
  if ("is_active" in source) {
    return {
      id: source.id,
      email: source.email,
      name: source.name,
      disabled: !source.is_active,
    };
  }
  return {
    id: source.id,
    email: source.email,
    name: source.name,
    disabled: source.disabledAt !== undefined,
  };
}

export function toChannelMember(
  source: CollaborationChannelMember | OpenWebUiChannelMemberResponse,
  user?: User,
): ChannelMember {
  if ("channel_id" in source) {
    const member: ChannelMember = {
      id: source.id,
      channelId: source.channel_id,
      userId: source.user_id,
      active: source.is_active,
      muted: source.is_channel_muted,
      pinned: source.is_channel_pinned,
      createdAt: requiredIsoFromEpoch(source.created_at),
      updatedAt: requiredIsoFromEpoch(source.updated_at),
    };
    assignOptionalMemberFields(member, {
      invitedAt: isoFromEpoch(source.invited_at),
      invitedBy: source.invited_by ?? undefined,
      joinedAt: isoFromEpoch(source.joined_at),
      lastReadAt: isoFromEpoch(source.last_read_at),
      leftAt: isoFromEpoch(source.left_at),
      role: source.role ?? undefined,
      status: source.status ?? undefined,
      user,
    });
    return member;
  }
  const member: ChannelMember = {
    id: source.id,
    channelId: source.channelId,
    userId: source.userId,
    active: source.isActive,
    muted: source.isChannelMuted,
    pinned: source.isChannelPinned,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  };
  assignOptionalMemberFields(member, {
    invitedAt: source.invitedAt,
    invitedBy: source.invitedBy,
    joinedAt: source.joinedAt,
    lastReadAt: source.lastReadAt,
    leftAt: source.leftAt,
    role: source.role,
    status: source.status,
    user,
  });
  return member;
}

function assignOptionalMemberFields(
  member: ChannelMember,
  input: {
    invitedAt?: string | undefined;
    invitedBy?: string | undefined;
    joinedAt?: string | undefined;
    lastReadAt?: string | undefined;
    leftAt?: string | undefined;
    role?: string | undefined;
    status?: string | undefined;
    user?: User | undefined;
  },
): void {
  if (input.invitedAt !== undefined) member.invitedAt = input.invitedAt;
  if (input.invitedBy !== undefined) member.invitedBy = input.invitedBy;
  if (input.joinedAt !== undefined) member.joinedAt = input.joinedAt;
  if (input.lastReadAt !== undefined) member.lastReadAt = input.lastReadAt;
  if (input.leftAt !== undefined) member.leftAt = input.leftAt;
  if (input.role !== undefined) member.role = input.role;
  if (input.status !== undefined) member.status = input.status;
  if (input.user !== undefined) member.user = toChannelUser(input.user);
}

export function toChannelMessage(
  source: OpenWebUiChannelMessageResponse,
): ChannelMessage {
  const message: ChannelMessage = {
    id: source.id,
    channelId: source.channel_id,
    authorUserId: source.user_id,
    content: source.content,
    createdAt: requiredIsoFromEpoch(source.created_at),
    updatedAt: requiredIsoFromEpoch(source.updated_at),
    pinned: source.is_pinned,
    reactions: toChannelReactions(source.reactions),
    replyCount: source.reply_count,
  };
  if (source.user !== null) message.author = toChannelUser(source.user);
  if (source.parent_id !== null) message.parentMessageId = source.parent_id;
  if (source.reply_to_id !== null)
    message.replyToMessageId = source.reply_to_id;
  if (source.reply_to_message !== null) {
    message.replyToMessage = toChannelMessage(source.reply_to_message);
  }
  if (source.latest_reply_at !== null) {
    message.latestReplyAt = requiredIsoFromEpoch(source.latest_reply_at);
  }
  if (source.pinned_by !== null) message.pinnedBy = source.pinned_by;
  if (source.pinned_at !== null) {
    message.pinnedAt = requiredIsoFromEpoch(source.pinned_at);
  }
  return message;
}

function toChannelReactions(reactions: unknown[]): ChannelMessageReaction[] {
  return reactions
    .map((reaction) => {
      if (
        typeof reaction !== "object" ||
        reaction === null ||
        !("name" in reaction) ||
        !("user_id" in reaction)
      ) {
        return undefined;
      }
      const value = reaction as { name: unknown; user_id: unknown };
      if (typeof value.name !== "string" || typeof value.user_id !== "string") {
        return undefined;
      }
      return { name: value.name, userId: value.user_id };
    })
    .filter(
      (reaction): reaction is ChannelMessageReaction => reaction !== undefined,
    );
}

export function toChannelEvent(source: OpenWebUiChannelEvent): ChannelEvent {
  const event: ChannelEvent = {
    id: source.id,
    channelId: source.channel_id,
    createdAt: requiredIsoFromEpoch(source.created_at),
    type: source.data.type,
  };
  if (source.message_id !== null) event.messageId = source.message_id;
  if (source.user !== null) event.actor = toChannelUser(source.user);
  if (source.channel !== null) event.channel = toChannel(source.channel);
  const data = toChannelEventData(source.data.data);
  if (data !== undefined) event.data = data;
  return event;
}

function toChannelEventData(data: unknown): unknown {
  if (
    typeof data === "object" &&
    data !== null &&
    "channel_id" in data &&
    "content" in data &&
    "created_at" in data
  ) {
    return toChannelMessage(data as OpenWebUiChannelMessageResponse);
  }
  if (
    typeof data === "object" &&
    data !== null &&
    "user_id" in data &&
    "last_read_at" in data
  ) {
    const value = data as { last_read_at: unknown; user_id: unknown };
    return {
      userId: typeof value.user_id === "string" ? value.user_id : undefined,
      lastReadAt:
        typeof value.last_read_at === "number"
          ? requiredIsoFromEpoch(value.last_read_at)
          : undefined,
    };
  }
  return data;
}

function requiredIsoFromEpoch(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString();
}

function isoFromEpoch(epochSeconds: number | null): string | undefined {
  return epochSeconds === null ? undefined : requiredIsoFromEpoch(epochSeconds);
}

export function hashAuditValue(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

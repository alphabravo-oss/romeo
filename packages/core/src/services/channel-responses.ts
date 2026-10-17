import type { AuthSubject } from "@romeo/auth";

import type {
  CollaborationChannel,
  CollaborationChannelMember,
  User,
} from "../domain/entities";
import type {
  ChannelStoreListItem,
  ChannelStoreMessage,
  ChannelStoreChannel,
  ChannelStoreUser,
} from "./channel-store-types";
import {
  compareIsoDesc,
  normalizeChannelType,
  type StoredChannelReaction,
  type ChannelMessageRecord,
} from "./channel-metadata";
import { toEpochSeconds } from "./channel-values";

export function toChannelListItem(
  channel: CollaborationChannel,
  subject: AuthSubject,
  members: CollaborationChannelMember[],
  userById: Map<string, User>,
  messageRecords: ChannelMessageRecord[] = [],
): ChannelStoreListItem {
  const type = normalizeChannelType(channel.type) ?? null;
  const callerMember = members.find((member) => member.userId === subject.id);
  const item: ChannelStoreListItem = {
    ...toChannelBase(channel),
    last_message_at: channelLastMessageAt(messageRecords),
    unread_count: channelUnreadCount(messageRecords, callerMember, subject.id),
  };
  if (type === "dm") {
    item.user_ids = members.map((member) => member.userId).sort();
    item.users = item.user_ids
      .map((userId) => userById.get(userId))
      .filter((user): user is User => user !== undefined)
      .map(toChannelUserResponse);
  }
  if (callerMember?.isChannelPinned === true) {
    item.meta = { ...item.meta, is_channel_pinned: true };
  }
  return item;
}

export function toChannelResponse(
  channel: CollaborationChannel,
  subject: AuthSubject,
  members: CollaborationChannelMember[],
  userById: Map<string, User>,
  writeAccess: boolean,
  messageRecords: ChannelMessageRecord[] = [],
): ChannelStoreChannel {
  const listItem = toChannelListItem(
    channel,
    subject,
    members,
    userById,
    messageRecords,
  );
  const activeMembers = members.filter((member) => member.isActive);
  if (normalizeChannelType(channel.type) === "group") {
    listItem.user_ids = activeMembers.map((member) => member.userId).sort();
    listItem.users = listItem.user_ids
      .map((userId) => userById.get(userId))
      .filter((user): user is User => user !== undefined)
      .map(toChannelUserResponse);
  }
  const callerMember = members.find((member) => member.userId === subject.id);
  return {
    ...listItem,
    is_manager:
      subject.isAdmin === true ||
      channel.userId === subject.id ||
      callerMember?.role === "manager",
    write_access: writeAccess,
    user_count: activeMembers.length,
    last_read_at:
      callerMember?.lastReadAt === undefined
        ? null
        : toEpochSeconds(callerMember.lastReadAt),
  };
}

export function toChannelUserResponse(user: User): ChannelStoreUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: "user",
    profile_image_url: "",
    is_active: user.disabledAt === undefined,
    status_emoji: "",
    status_message: "",
    status_expires_at: null,
  };
}

export function toChannelMessageResponse(
  record: ChannelMessageRecord,
  userById: Map<string, User>,
  records: ChannelMessageRecord[],
  options: { includeReply?: boolean } = {},
): ChannelStoreMessage {
  const replies = records.filter(
    (candidate) => candidate.metadata.parentId === record.message.id,
  );
  const latestReply = [...replies].sort((left, right) =>
    compareIsoDesc(left.message.createdAt, right.message.createdAt),
  )[0];
  const replyToRecord =
    options.includeReply === false || record.metadata.replyToId === undefined
      ? undefined
      : records.find(
          (candidate) => candidate.message.id === record.metadata.replyToId,
        );
  const user = userById.get(record.metadata.userId);
  return {
    id: record.message.id,
    user_id: record.metadata.userId,
    channel_id: record.metadata.channelId,
    reply_to_id: record.metadata.replyToId ?? null,
    parent_id: record.metadata.parentId ?? null,
    is_pinned: record.metadata.isPinned === true,
    pinned_by: record.metadata.pinnedBy ?? null,
    pinned_at:
      record.metadata.pinnedAt === undefined
        ? null
        : toEpochSeconds(record.metadata.pinnedAt),
    content: record.metadata.content ?? record.message.content,
    data: channelMessageDataValue(record.metadata.data),
    meta: record.metadata.meta ?? null,
    created_at: toEpochSeconds(record.message.createdAt),
    updated_at: toEpochSeconds(
      record.metadata.updatedAt ?? record.message.createdAt,
    ),
    user: user === undefined ? null : toChannelUserResponse(user),
    reply_to_message:
      replyToRecord === undefined
        ? null
        : toChannelMessageResponse(replyToRecord, userById, records, {
            includeReply: false,
          }),
    latest_reply_at:
      latestReply === undefined
        ? null
        : toEpochSeconds(latestReply.message.createdAt),
    reply_count: replies.length,
    reactions: channelMessageReactionResponses(record.metadata.reactions ?? []),
  };
}

function toChannelBase(
  channel: CollaborationChannel,
): Omit<
  ChannelStoreListItem,
  "last_message_at" | "unread_count" | "user_ids" | "users"
> {
  return {
    id: channel.id,
    user_id: channel.userId,
    type: normalizeChannelType(channel.type) ?? null,
    name: channel.name,
    description: channel.description ?? null,
    is_private: channel.isPrivate ?? null,
    data: channel.data ?? null,
    meta: channel.meta ?? null,
    access_grants: [],
    created_at: toEpochSeconds(channel.createdAt),
    updated_at: toEpochSeconds(channel.updatedAt),
    updated_by: channel.updatedBy ?? null,
    archived_at:
      channel.archivedAt === undefined
        ? null
        : toEpochSeconds(channel.archivedAt),
    archived_by: channel.archivedBy ?? null,
    deleted_at:
      channel.deletedAt === undefined
        ? null
        : toEpochSeconds(channel.deletedAt),
    deleted_by: channel.deletedBy ?? null,
  };
}

function channelMessageReactionResponses(
  reactions: StoredChannelReaction[],
): Array<{ name: string; user_id: string }> {
  return reactions.map((reaction) => ({
    user_id: reaction.userId,
    name: reaction.name,
  }));
}

function channelMessageDataValue(
  data: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null | boolean {
  if (data === undefined || data === null) return false;
  return data;
}

function channelLastMessageAt(records: ChannelMessageRecord[]): number | null {
  const latest = records
    .filter((record) => record.metadata.parentId === undefined)
    .sort((left, right) =>
      compareIsoDesc(left.message.createdAt, right.message.createdAt),
    )[0];
  return latest === undefined ? null : toEpochSeconds(latest.message.createdAt);
}

function channelUnreadCount(
  records: ChannelMessageRecord[],
  callerMember: CollaborationChannelMember | undefined,
  userId: string,
): number {
  if (callerMember === undefined || callerMember.isActive !== true) return 0;
  return records.filter((record) => {
    if (record.metadata.userId === userId) return false;
    if (callerMember.lastReadAt === undefined) return true;
    return record.message.createdAt > callerMember.lastReadAt;
  }).length;
}

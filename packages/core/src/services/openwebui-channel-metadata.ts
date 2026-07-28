import { createHash } from "node:crypto";

import type {
  Chat,
  CollaborationChannel,
  CollaborationChannelMember,
  Message,
  MessagePart,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { createId } from "../ids";
import { asRecord, trimmedString } from "./openwebui-compatibility-values";

export interface OpenWebUiChannelMessageMetadata {
  schema: "romeo.openwebui-channel-message.v1";
  channelId: string;
  userId: string;
  updatedAt?: string | undefined;
  tempId?: string | undefined;
  content?: string | undefined;
  replyToId?: string | undefined;
  parentId?: string | undefined;
  data?: Record<string, unknown> | null | undefined;
  meta?: Record<string, unknown> | null | undefined;
  isPinned?: boolean | undefined;
  pinnedBy?: string | undefined;
  pinnedAt?: string | undefined;
  deletedAt?: string | undefined;
  deletedBy?: string | undefined;
  reactions?: OpenWebUiChannelMessageReaction[] | undefined;
}

export interface OpenWebUiChannelMessageReaction {
  userId: string;
  name: string;
}

export interface OpenWebUiChannelMessageRecord {
  message: Message;
  metadata: OpenWebUiChannelMessageMetadata;
}

export function normalizeChannelType(value: unknown): string | undefined {
  const type = trimmedString(value);
  if (type === undefined) return undefined;
  if (type === "group" || type === "dm") return type;
  throw new ApiError(
    "invalid_openwebui_channel",
    "Channel type must be group, dm, or empty.",
    400,
  );
}

export function normalizeChannelName(
  name: string,
  type: string | undefined,
): string {
  const normalized = name.trim().replace(/\s+/gu, "-").toLowerCase();
  if (type === "dm") return normalized.slice(0, 128);
  if (normalized.length === 0) {
    throw new ApiError(
      "invalid_openwebui_channel",
      "Channel name must not be empty.",
      400,
    );
  }
  return normalized.slice(0, 128);
}

export function channelMemberDraft(input: {
  channelId: string;
  orgId: string;
  userId: string;
  invitedBy: string;
  now: string;
  role?: string | undefined;
}): CollaborationChannelMember {
  return {
    id: createId("openwebui_channel_member"),
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

export function channelBackingChatId(channelId: string): string {
  const digest = createHash("sha256").update(channelId).digest("hex");
  return `chat_openwebui_${digest.slice(0, 24)}`;
}

export function channelEventBusKey(orgId: string, channelId: string): string {
  return `${orgId}:openwebui-channel:${channelId}`;
}

export async function ensureChannelBackingChat(
  repository: RomeoRepository,
  channel: CollaborationChannel,
  now: string,
): Promise<Chat> {
  const id = channelBackingChatId(channel.id);
  const existing = await repository.getChat(id);
  if (existing !== undefined) return existing;
  return repository.createChat({
    id,
    orgId: channel.orgId,
    workspaceId: channel.workspaceId,
    title: `Channel: ${channel.name}`.slice(0, 200),
    createdBy: channel.userId,
    updatedAt: now,
  });
}

export function normalizeChannelMessageContent(content: string): string {
  const normalized = content.trim();
  if (normalized.length === 0) {
    throw new ApiError(
      "invalid_openwebui_channel_message",
      "Channel message content must not be empty.",
      400,
    );
  }
  return normalized.slice(0, 20_000);
}

export function boundedOffset(value: number | undefined): number {
  if (value === undefined || !Number.isInteger(value) || value < 0) return 0;
  return Math.min(value, 100_000);
}

export function boundedLimit(
  value: number | undefined,
  fallback: number,
  max: number,
): number {
  if (value === undefined || !Number.isInteger(value) || value <= 0) {
    return fallback;
  }
  return Math.min(value, max);
}

export function boundedPage(value: number | undefined): number {
  if (value === undefined || !Number.isInteger(value) || value <= 0) return 1;
  return Math.min(value, 10_000);
}

export function compareIsoDesc(left: string, right: string): number {
  return right.localeCompare(left);
}

export function channelMessageMetadataFromParts(
  parts: MessagePart[],
  channelId: string,
): OpenWebUiChannelMessageMetadata | undefined {
  let latest: OpenWebUiChannelMessageMetadata | undefined;
  for (const part of parts) {
    if (part.type !== "collaboration_channel_metadata") continue;
    const metadata = asRecord(part.metadata);
    if (metadata?.schema !== "romeo.openwebui-channel-message.v1") continue;
    if (metadata.channelId !== channelId) continue;
    const userId = trimmedString(metadata.userId);
    if (userId === undefined) continue;
    const data =
      metadata.data === null ? null : (asRecord(metadata.data) ?? undefined);
    const meta =
      metadata.meta === null ? null : (asRecord(metadata.meta) ?? undefined);
    const candidate: OpenWebUiChannelMessageMetadata = {
      schema: "romeo.openwebui-channel-message.v1",
      channelId,
      userId,
      ...(trimmedString(metadata.updatedAt) === undefined
        ? {}
        : { updatedAt: trimmedString(metadata.updatedAt) }),
      ...(trimmedString(metadata.tempId) === undefined
        ? {}
        : { tempId: trimmedString(metadata.tempId) }),
      ...(trimmedString(metadata.content) === undefined
        ? {}
        : { content: trimmedString(metadata.content) }),
      ...(trimmedString(metadata.replyToId) === undefined
        ? {}
        : { replyToId: trimmedString(metadata.replyToId) }),
      ...(trimmedString(metadata.parentId) === undefined
        ? {}
        : { parentId: trimmedString(metadata.parentId) }),
      ...(data === undefined ? {} : { data }),
      ...(meta === undefined ? {} : { meta }),
      ...(metadata.isPinned === true ? { isPinned: true } : {}),
      ...(trimmedString(metadata.pinnedBy) === undefined
        ? {}
        : { pinnedBy: trimmedString(metadata.pinnedBy) }),
      ...(trimmedString(metadata.pinnedAt) === undefined
        ? {}
        : { pinnedAt: trimmedString(metadata.pinnedAt) }),
      ...(trimmedString(metadata.deletedAt) === undefined
        ? {}
        : { deletedAt: trimmedString(metadata.deletedAt) }),
      ...(trimmedString(metadata.deletedBy) === undefined
        ? {}
        : { deletedBy: trimmedString(metadata.deletedBy) }),
      ...(reactionsFromMetadata(metadata.reactions).length === 0
        ? {}
        : { reactions: reactionsFromMetadata(metadata.reactions) }),
    };
    if (
      latest === undefined ||
      (candidate.updatedAt ?? "") >= (latest.updatedAt ?? "")
    ) {
      latest = candidate;
    }
  }
  return latest;
}

export function normalizeReactionName(name: string): string {
  const normalized = name.trim();
  if (normalized.length === 0 || normalized.length > 120) {
    throw new ApiError(
      "invalid_openwebui_channel_reaction",
      "Channel message reaction must be between 1 and 120 characters.",
      400,
    );
  }
  return normalized;
}

export async function appendChannelMessageMetadata(
  repository: RomeoRepository,
  messageId: string,
  metadata: OpenWebUiChannelMessageMetadata,
): Promise<void> {
  await repository.createMessageParts([
    {
      id: createId("message_part"),
      messageId,
      type: "collaboration_channel_metadata",
      content: "",
      metadata: { ...metadata },
    },
  ]);
}

export function replaceChannelMessageRecord(
  records: OpenWebUiChannelMessageRecord[],
  messageId: string,
  metadata: OpenWebUiChannelMessageMetadata,
): OpenWebUiChannelMessageRecord[] {
  return records.map((record) =>
    record.message.id === messageId ? { ...record, metadata } : record,
  );
}

function reactionsFromMetadata(
  value: unknown,
): OpenWebUiChannelMessageReaction[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const reactions: OpenWebUiChannelMessageReaction[] = [];
  for (const item of value) {
    const record = asRecord(item);
    const userId = trimmedString(record?.userId);
    const name = trimmedString(record?.name);
    if (userId === undefined || name === undefined) continue;
    const key = `${userId}:${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    reactions.push({ userId, name });
  }
  return reactions.slice(0, 500);
}

import { createHash } from "node:crypto";

import type {
  Chat,
  CollaborationChannel,
  Message,
  MessagePart,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { createId } from "../ids";
import { asRecord, trimmedString } from "./channel-values";

// Persisted identifiers: channel messages live in a hidden backing chat whose
// message parts carry this metadata schema. The values predate the removal of
// the OpenWebUI compatibility layer and are kept so stored channels still load.
export const CHANNEL_MESSAGE_METADATA_SCHEMA =
  "romeo.openwebui-channel-message.v1";
const CHANNEL_BACKING_CHAT_ID_PREFIX = "chat_openwebui_";

export interface ChannelMessageMetadata {
  schema: typeof CHANNEL_MESSAGE_METADATA_SCHEMA;
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
  reactions?: StoredChannelReaction[] | undefined;
}

export interface StoredChannelReaction {
  userId: string;
  name: string;
}

export interface ChannelMessageRecord {
  message: Message;
  metadata: ChannelMessageMetadata;
}

export function normalizeChannelType(value: unknown): string | undefined {
  const type = trimmedString(value);
  if (type === undefined) return undefined;
  if (type === "group" || type === "dm") return type;
  throw new ApiError(
    "invalid_channel",
    "Channel type must be group, dm, or empty.",
    400,
  );
}

export function channelBackingChatId(channelId: string): string {
  const digest = createHash("sha256").update(channelId).digest("hex");
  return `${CHANNEL_BACKING_CHAT_ID_PREFIX}${digest.slice(0, 24)}`;
}

export function channelEventBusKey(orgId: string, channelId: string): string {
  return `${orgId}:channel:${channelId}`;
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
      "invalid_channel_message",
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
): ChannelMessageMetadata | undefined {
  let latest: ChannelMessageMetadata | undefined;
  for (const part of parts) {
    if (part.type !== "collaboration_channel_metadata") continue;
    const metadata = asRecord(part.metadata);
    if (metadata?.schema !== CHANNEL_MESSAGE_METADATA_SCHEMA) continue;
    if (metadata.channelId !== channelId) continue;
    const userId = trimmedString(metadata.userId);
    if (userId === undefined) continue;
    const data =
      metadata.data === null ? null : (asRecord(metadata.data) ?? undefined);
    const meta =
      metadata.meta === null ? null : (asRecord(metadata.meta) ?? undefined);
    const candidate: ChannelMessageMetadata = {
      schema: CHANNEL_MESSAGE_METADATA_SCHEMA,
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
      "invalid_channel_reaction",
      "Channel message reaction must be between 1 and 120 characters.",
      400,
    );
  }
  return normalized;
}

export async function appendChannelMessageMetadata(
  repository: RomeoRepository,
  messageId: string,
  metadata: ChannelMessageMetadata,
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
  records: ChannelMessageRecord[],
  messageId: string,
  metadata: ChannelMessageMetadata,
): ChannelMessageRecord[] {
  return records.map((record) =>
    record.message.id === messageId ? { ...record, metadata } : record,
  );
}

function reactionsFromMetadata(value: unknown): StoredChannelReaction[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const reactions: StoredChannelReaction[] = [];
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

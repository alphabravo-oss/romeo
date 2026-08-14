import {
  isMessagePartV1,
  parseMessagePartV1,
  type MessagePart,
} from "@romeo/core";

import { toIsoString } from "./repository-mapping";
import { messageParts } from "./schema";

export type MessagePartRecord = MessagePart;

const typedTextStoragePrefix = "romeo-message-text-v1:";
const typedMessagePartTypes = new Set([
  "text",
  "image_ref",
  "audio_ref",
  "video_ref",
  "document_ref",
  "tool_result_ref",
  "artifact_ref",
  "citation_ref",
]);

export function toMessagePartRecord(
  row: Pick<
    typeof messageParts.$inferSelect,
    "content" | "id" | "messageId" | "metadata" | "position" | "type"
  > &
    Partial<
      Pick<
        typeof messageParts.$inferSelect,
        "canonicalPosition" | "createdAt" | "schemaVersion"
      >
    >,
): MessagePartRecord {
  if (
    row.schemaVersion !== undefined &&
    row.schemaVersion !== 0 &&
    row.schemaVersion !== 1
  )
    throw new Error("Unsupported stored message part schema version.");
  if (row.schemaVersion === 1) return typedMessagePartRecord(row);
  return {
    id: row.id,
    messageId: row.messageId,
    type:
      row.type === "collaboration_channel_metadata"
        ? "collaboration_channel_metadata"
        : "attachment",
    content: row.content,
    metadata: asJsonRecord(row.metadata),
  };
}

export function toMessagePartInsert(
  record: MessagePartRecord,
  position: number,
): typeof messageParts.$inferInsert {
  if (isMessagePartV1(record)) {
    const parsed = parseMessagePartV1(record);
    const { createdAt, id, messageId, position: canonicalPosition } = parsed;
    const content =
      parsed.type === "text" ? typedTextStoragePrefix + parsed.text : "";
    const payload: Record<string, unknown> = { ...parsed };
    for (const key of reservedPartMetadataKeys) delete payload[key];
    return {
      id,
      messageId,
      position: canonicalPosition,
      canonicalPosition,
      schemaVersion: parsed.schemaVersion,
      type: parsed.type,
      content,
      metadata: payload,
      createdAt: new Date(createdAt),
    };
  }
  return {
    id: record.id,
    messageId: record.messageId,
    position,
    type: record.type,
    content: record.content,
    metadata: record.metadata,
  };
}

function typedMessagePartRecord(
  row: Parameters<typeof toMessagePartRecord>[0],
): MessagePartRecord {
  if (!(row.createdAt instanceof Date))
    throw new Error("Invalid stored typed message part timestamp.");
  if (!typedMessagePartTypes.has(row.type))
    throw new Error("Invalid stored typed message part type.");
  const metadata = asJsonRecord(row.metadata);
  assertNoReservedPartMetadata(metadata);
  if (row.type === "text" && !row.content.startsWith(typedTextStoragePrefix))
    throw new Error("Invalid stored typed message part content.");
  if (row.type !== "text" && row.content.length > 0)
    throw new Error("Invalid stored typed message part content.");
  return parseMessagePartV1({
    ...metadata,
    schemaVersion: 1,
    type: row.type,
    id: row.id,
    messageId: row.messageId,
    position: row.canonicalPosition ?? row.position,
    createdAt: toIsoString(row.createdAt),
    ...(row.type === "text"
      ? { text: row.content.slice(typedTextStoragePrefix.length) }
      : {}),
  });
}

const reservedPartMetadataKeys = [
  "createdAt",
  "id",
  "messageId",
  "position",
  "schemaVersion",
  "text",
  "type",
];

function assertNoReservedPartMetadata(metadata: Record<string, unknown>): void {
  for (const key of reservedPartMetadataKeys) {
    if (key in metadata)
      throw new Error("Invalid stored typed message part metadata.");
  }
}

function asJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return {};
  return value as Record<string, unknown>;
}

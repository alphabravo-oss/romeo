import {
  MessagePartOutputSchema,
  type MessagePartOutput,
} from "@romeo/contracts";
import { createHash } from "node:crypto";

import type {
  LegacyMessagePart,
  Message,
  MessagePart,
} from "../domain/entities";

export function parseMessagePartV1(value: unknown): MessagePartOutput {
  return MessagePartOutputSchema.parse(value);
}

export function isMessagePartV1(part: MessagePart): part is MessagePartOutput {
  return "schemaVersion" in part && part.schemaVersion === 1;
}

export function isLegacyMessagePart(
  part: MessagePart,
): part is LegacyMessagePart {
  return !("schemaVersion" in part);
}

export function isLegacyAttachmentPart(
  part: MessagePart,
): part is LegacyMessagePart & { type: "attachment" } {
  return isLegacyMessagePart(part) && part.type === "attachment";
}

export function fileIdsForMessagePart(part: MessagePart): string[] {
  if (!isMessagePartV1(part)) return [];
  let ids: string[];
  switch (part.type) {
    case "image_ref":
      ids = [part.fileId, part.transform?.sourceFileId].filter(
        (value): value is string => value !== undefined,
      );
      break;
    case "audio_ref":
      ids = [part.fileId, part.waveformFileId].filter(
        (value): value is string => value !== undefined,
      );
      break;
    case "video_ref":
      ids = [part.fileId, ...(part.keyframeFileIds ?? [])];
      break;
    case "document_ref":
      ids = [part.fileId];
      break;
    default:
      ids = [];
  }
  return [...new Set(ids)];
}

export function textPartForMessage(input: {
  id: string;
  message: Pick<Message, "content" | "createdAt" | "id">;
  position: number;
}): MessagePartOutput | undefined {
  if (input.message.content.length === 0) return undefined;
  return parseMessagePartV1({
    schemaVersion: 1,
    type: "text",
    id: input.id,
    messageId: input.message.id,
    position: input.position,
    createdAt: input.message.createdAt,
    text: input.message.content,
  });
}

export function legacyTextProjection(
  message: Pick<Message, "content" | "createdAt" | "id">,
  position: number,
): MessagePartOutput | undefined {
  return textPartForMessage({
    id: persistedTextPartId(message.id),
    message,
    position,
  });
}

export function persistedTextPartId(messageId: string): string {
  return `msg_part_text_${createHash("md5").update(messageId).digest("hex")}`;
}

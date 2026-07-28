import type { AuthSubject } from "@romeo/auth";
import type { ObjectStore } from "@romeo/storage";

import type {
  Message,
  MessageAttachment,
  MessagePart,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { getAuthorizedChat } from "./chat-access";
import { assertFileContentMatchesMimeType } from "./file-signature";
import {
  assertFileMalwareScanClean,
  type FileMalwareScanner,
  type FileMalwareScanPolicy,
} from "./file-service";

const allowedImageMimeTypes = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const allowedDocumentMimeTypes = new Set([
  "application/json",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/csv",
  "text/html",
  "text/markdown",
  "text/plain",
]);
export const defaultMessageAttachmentMaxBytes = 25_000_000;
const maxAttachments = 8;

export interface ChatAttachmentInput {
  dataBase64: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  extractedText?: string;
  retainedInContext?: boolean;
}

export async function attachMessageParts(
  repository: RomeoRepository,
  messages: Message[],
): Promise<Message[]> {
  return Promise.all(
    messages.map(async (message) => {
      const attachments = (await repository.listMessageParts(message.id))
        .map((part) => publicAttachment(part, message.chatId))
        .filter((part): part is MessageAttachment => part !== undefined);
      return attachments.length === 0 ? message : { ...message, attachments };
    }),
  );
}

export async function storeMessageAttachments(input: {
  attachments?: ChatAttachmentInput[];
  maxAttachmentBytes?: number;
  messageId: string;
  objectStore: ObjectStore;
  storedObjectKeys?: string[];
  malwareScanning?: {
    policy: FileMalwareScanPolicy;
    scanner?: FileMalwareScanner;
  };
}): Promise<MessagePart[]> {
  if (input.attachments === undefined || input.attachments.length === 0)
    return [];
  if (input.attachments.length > maxAttachments) {
    throw new ApiError(
      "message_attachment_limit_exceeded",
      "A message can include at most eight attachments.",
      400,
    );
  }

  const parts: MessagePart[] = [];
  const maxAttachmentBytes =
    input.maxAttachmentBytes ?? defaultMessageAttachmentMaxBytes;
  for (const attachment of input.attachments) {
    const normalized = normalizeAttachment(attachment, maxAttachmentBytes);
    if (input.malwareScanning !== undefined) {
      await assertFileMalwareScanClean(input.malwareScanning, {
        bytes: normalized.bytes,
        fileName: normalized.fileName,
        mimeType: normalized.mimeType,
      });
    }
    const attachmentId = createId("msg_part");
    const objectKey = `chat-attachments/${input.messageId}/${attachmentId}/${normalized.fileName}`;
    await input.objectStore.putObject({
      key: objectKey,
      body: normalized.bytes,
      contentType: normalized.mimeType,
    });
    input.storedObjectKeys?.push(objectKey);
    parts.push({
      id: attachmentId,
      messageId: input.messageId,
      type: "attachment",
      content: objectKey,
      metadata: {
        fileName: normalized.fileName,
        kind: allowedImageMimeTypes.has(normalized.mimeType)
          ? "image"
          : "document",
        mimeType: normalized.mimeType,
        sizeBytes: normalized.bytes.byteLength,
        retainedInContext: attachment.retainedInContext !== false,
        ...(attachment.extractedText === undefined
          ? {}
          : { extractedText: attachment.extractedText.slice(0, 500_000) }),
      },
    });
  }
  return parts;
}

export async function readMessageAttachment(input: {
  attachmentId: string;
  chatId: string;
  messageId: string;
  objectStore: ObjectStore;
  repository: RomeoRepository;
  subject: AuthSubject;
}): Promise<{
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}> {
  await getAuthorizedChat(input.repository, {
    chatId: input.chatId,
    subject: input.subject,
    scope: "chats:read",
    permission: "read",
  });
  const message = await input.repository.getMessage(input.messageId);
  if (!message || message.chatId !== input.chatId) throw notFound("Message");
  const part = await input.repository.getMessagePart(input.attachmentId);
  if (!part || part.messageId !== input.messageId || part.type !== "attachment")
    throw notFound("Message attachment");
  const attachment = publicAttachment(part, input.chatId);
  if (attachment === undefined) throw notFound("Message attachment");
  const bytes = await input.objectStore.getObject(part.content);
  if (bytes === undefined)
    throw new ApiError(
      "message_attachment_object_missing",
      "Message attachment object was not found.",
      409,
    );
  return {
    bytes,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    sizeBytes: bytes.byteLength,
  };
}

function publicAttachment(
  part: MessagePart,
  chatId: string,
): MessageAttachment | undefined {
  if (part.type !== "attachment") return undefined;
  const fileName = part.metadata.fileName;
  const mimeType = part.metadata.mimeType;
  const sizeBytes = part.metadata.sizeBytes;
  if (
    typeof fileName !== "string" ||
    typeof mimeType !== "string" ||
    typeof sizeBytes !== "number"
  )
    return undefined;
  if (
    !allowedImageMimeTypes.has(mimeType) &&
    !allowedDocumentMimeTypes.has(mimeType)
  )
    return undefined;
  return {
    id: part.id,
    messageId: part.messageId,
    fileName,
    mimeType,
    sizeBytes,
    kind: allowedImageMimeTypes.has(mimeType) ? "image" : "document",
    retainedInContext: part.metadata.retainedInContext !== false,
    previewUrl: `/api/v1/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(part.messageId)}/attachments/${encodeURIComponent(part.id)}`,
  };
}

function normalizeAttachment(
  input: ChatAttachmentInput,
  maxAttachmentBytes: number,
): { bytes: Uint8Array; fileName: string; mimeType: string } {
  const mimeType = input.mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (
    !allowedImageMimeTypes.has(mimeType) &&
    !allowedDocumentMimeTypes.has(mimeType)
  ) {
    throw new ApiError(
      "unsupported_message_attachment_type",
      "The attachment MIME type is not supported.",
      415,
      { mimeType: input.mimeType },
    );
  }
  if (
    !Number.isInteger(input.sizeBytes) ||
    input.sizeBytes <= 0 ||
    input.sizeBytes > maxAttachmentBytes
  ) {
    throw new ApiError(
      "message_attachment_size_invalid",
      "Attachment size is outside the supported range.",
      400,
      { maxBytes: maxAttachmentBytes },
    );
  }
  const bytes = decodeBase64(input.dataBase64);
  if (bytes.byteLength !== input.sizeBytes) {
    throw new ApiError(
      "message_attachment_size_mismatch",
      "Image attachment byte count does not match the declared size.",
      400,
    );
  }
  assertFileContentMatchesMimeType(bytes, mimeType, {
    code: "message_attachment_mime_mismatch",
    message: "Image attachment bytes do not match the declared MIME type.",
  });
  return { bytes, fileName: safeFileName(input.fileName), mimeType };
}

function decodeBase64(value: string): Uint8Array {
  const raw = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
  if (
    raw.length === 0 ||
    raw.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]*={0,2}$/u.test(raw)
  ) {
    throw new ApiError(
      "message_attachment_base64_invalid",
      "Image attachment must be valid base64.",
      400,
    );
  }
  return new Uint8Array(Buffer.from(raw, "base64"));
}

function safeFileName(fileName: string): string {
  const leaf = fileName.split(/[\\/]/u).pop()?.trim() ?? "";
  const normalized = leaf
    .replace(/[^A-Za-z0-9._-]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 160);
  return normalized.length === 0 ? "image" : normalized;
}

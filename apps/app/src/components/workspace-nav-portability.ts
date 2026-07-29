import type { Chat, Message } from "../features/types";
import { listMessages } from "../features";
import { downloadText } from "../lib/download";

export const portableChatImportLimits = {
  attachmentBytes: 25_000_000,
  attachmentDataCharacters: 34_000_000,
  attachmentTotalBytes: 50_000_000,
  attachmentsPerMessage: 8,
  citationCount: 100,
  contentCharacters: 1_000_000,
  fileBytes: 50_000_000,
  fileNameCharacters: 160,
  messageCount: 10_000,
  mimeTypeCharacters: 200,
  titleCharacters: 200,
} as const;

export type PortableChatImportErrorCode =
  | "attachment_budget_exceeded"
  | "file_too_large"
  | "invalid_attachment"
  | "invalid_citation"
  | "invalid_envelope"
  | "invalid_message"
  | "invalid_timestamp"
  | "malformed_json"
  | "no_messages"
  | "too_many_messages";

export class PortableChatImportError extends Error {
  constructor(readonly code: PortableChatImportErrorCode) {
    super(code);
    this.name = "PortableChatImportError";
  }
}

export async function downloadChatMarkdown(chat: Chat): Promise<void> {
  const messages = await listMessages(chat.id);
  const markdown = [
    `# ${chat.title}`,
    "",
    ...messages.flatMap((message) => [
      `## ${message.role === "assistant" ? "Romeo" : "User"}`,
      "",
      message.content,
      "",
    ]),
  ].join("\n");
  downloadText(markdown, `${safeExportName(chat.title)}.md`, "text/markdown");
}

export async function parsePortableChat(file: File): Promise<{
  messages: PortableMessage[];
  modelId?: string;
  title: string;
}> {
  if (file.size > portableChatImportLimits.fileBytes) {
    throw new PortableChatImportError("file_too_large");
  }
  let parsed: PortableChatDocument;
  try {
    parsed = JSON.parse(await file.text()) as PortableChatDocument;
  } catch {
    throw new PortableChatImportError("malformed_json");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new PortableChatImportError("invalid_envelope");
  }
  const payload = parsed.data ?? parsed;
  if (typeof payload !== "object" || payload === null) {
    throw new PortableChatImportError("invalid_envelope");
  }
  if (!Array.isArray(payload.messages)) {
    throw new PortableChatImportError("no_messages");
  }
  if (payload.messages.length > portableChatImportLimits.messageCount) {
    throw new PortableChatImportError("too_many_messages");
  }

  const messages = payload.messages.map(parsePortableMessage);
  if (messages.length === 0) {
    throw new PortableChatImportError("no_messages");
  }
  const attachmentBytes = messages.reduce(
    (total, message) =>
      total +
      (message.attachments ?? []).reduce(
        (messageTotal, attachment) => messageTotal + attachment.sizeBytes,
        0,
      ),
    0,
  );
  if (attachmentBytes > portableChatImportLimits.attachmentTotalBytes) {
    throw new PortableChatImportError("attachment_budget_exceeded");
  }

  const rawTitle =
    payload.chat?.title ??
    payload.title ??
    file.name.replace(/\.json$/iu, "") ??
    "";
  const title = normalizedBoundedString(
    rawTitle,
    portableChatImportLimits.titleCharacters,
  );
  if (title === undefined) {
    throw new PortableChatImportError("invalid_envelope");
  }
  const modelId = normalizedBoundedString(payload.chat?.modelId, 300);
  return {
    title,
    ...(modelId === undefined ? {} : { modelId }),
    messages,
  };
}

interface PortableChatPayload {
  chat?: { title?: unknown; modelId?: unknown };
  messages?: unknown;
  title?: unknown;
}

interface PortableChatDocument extends PortableChatPayload {
  data?: PortableChatPayload;
}

interface PortableAttachment {
  dataBase64: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  retainedInContext?: boolean;
}

interface PortableMessage {
  role: "assistant" | "system" | "tool" | "user";
  content: string;
  createdAt?: string;
  citations?: NonNullable<Message["citations"]>;
  attachments?: PortableAttachment[];
}

function parsePortableMessage(raw: unknown): PortableMessage {
  if (typeof raw !== "object" || raw === null) {
    throw new PortableChatImportError("invalid_message");
  }
  const item = raw as Record<string, unknown>;
  const role = item.role;
  const content = item.content;
  if (
    (role !== "system" &&
      role !== "user" &&
      role !== "assistant" &&
      role !== "tool") ||
    typeof content !== "string" ||
    content.length > portableChatImportLimits.contentCharacters
  ) {
    throw new PortableChatImportError("invalid_message");
  }
  const createdAt = optionalTimestamp(item.createdAt);
  const citations = parsePortableCitations(item.citations);
  const attachments = parsePortableAttachments(item.attachments);
  return {
    role,
    content,
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(citations.length === 0 ? {} : { citations }),
    ...(attachments.length === 0 ? {} : { attachments }),
  };
}

function safeExportName(value: string): string {
  return (
    value
      .trim()
      .replace(/[^A-Za-z0-9._-]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 80) || "romeo-chat"
  );
}

function parsePortableCitations(
  value: unknown,
): NonNullable<Message["citations"]> {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > portableChatImportLimits.citationCount
  ) {
    throw new PortableChatImportError("invalid_citation");
  }
  return value.map((raw) => {
    if (typeof raw !== "object" || raw === null) {
      throw new PortableChatImportError("invalid_citation");
    }
    const item = raw as Record<string, unknown>;
    const chunkId = normalizedBoundedString(item.chunkId, 300);
    const documentId = normalizedBoundedString(item.documentId, 300);
    const title = normalizedBoundedString(item.title, 1_000);
    if (
      chunkId === undefined ||
      documentId === undefined ||
      title === undefined
    ) {
      throw new PortableChatImportError("invalid_citation");
    }
    return {
      chunkId,
      documentId,
      title,
      ...portableCitationField(item, "sourceUri"),
      ...portableCitationField(item, "sourceType", 100),
      ...portableCitationField(item, "provider", 100),
      ...portableCitationTimestamp(item, "retrievedAt"),
      ...portableCitationTimestamp(item, "accessedAt"),
      ...portableCitationTimestamp(item, "publishedAt"),
    };
  });
}

function portableCitationField(
  item: Record<string, unknown>,
  key: string,
  maximum = 10_000,
): Record<string, string> {
  if (item[key] === undefined) return {};
  const value = normalizedBoundedString(item[key], maximum);
  if (value === undefined) {
    throw new PortableChatImportError("invalid_citation");
  }
  return { [key]: value };
}

function portableCitationTimestamp(
  item: Record<string, unknown>,
  key: string,
): Record<string, string> {
  if (item[key] === undefined) return {};
  return { [key]: requiredTimestamp(item[key]) };
}

function parsePortableAttachments(value: unknown): PortableAttachment[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > portableChatImportLimits.attachmentsPerMessage
  ) {
    throw new PortableChatImportError("invalid_attachment");
  }
  return value.map((raw) => {
    if (typeof raw !== "object" || raw === null) {
      throw new PortableChatImportError("invalid_attachment");
    }
    const item = raw as Record<string, unknown>;
    const dataBase64 = item.dataBase64;
    const fileName = normalizedBoundedString(
      item.fileName,
      portableChatImportLimits.fileNameCharacters,
    );
    const mimeType = normalizedBoundedString(
      item.mimeType,
      portableChatImportLimits.mimeTypeCharacters,
    );
    const sizeBytes = item.sizeBytes;
    if (
      typeof dataBase64 !== "string" ||
      dataBase64.length === 0 ||
      dataBase64.length > portableChatImportLimits.attachmentDataCharacters ||
      !/^[A-Za-z0-9+/]*={0,2}$/u.test(dataBase64) ||
      fileName === undefined ||
      /[\\/\0]/u.test(fileName) ||
      mimeType === undefined ||
      !/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/u.test(mimeType) ||
      typeof sizeBytes !== "number" ||
      !Number.isInteger(sizeBytes) ||
      sizeBytes <= 0 ||
      sizeBytes > portableChatImportLimits.attachmentBytes
    ) {
      throw new PortableChatImportError("invalid_attachment");
    }
    return {
      dataBase64,
      fileName,
      mimeType,
      sizeBytes,
      ...(typeof item.retainedInContext === "boolean"
        ? { retainedInContext: item.retainedInContext }
        : {}),
    };
  });
}

function normalizedBoundedString(
  value: unknown,
  maximum: number,
): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maximum
    ? normalized
    : undefined;
}

function optionalTimestamp(value: unknown): string | undefined {
  return value === undefined ? undefined : requiredTimestamp(value);
}

function requiredTimestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T/u.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new PortableChatImportError("invalid_timestamp");
  }
  return value;
}

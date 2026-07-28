import type { Chat, Message } from "../features/types";
import { listMessages } from "../features";

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
  const url = URL.createObjectURL(
    new Blob([markdown], { type: "text/markdown" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeExportName(chat.title)}.md`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function parsePortableChat(file: File): Promise<{
  messages: PortableMessage[];
  modelId?: string;
  title: string;
}> {
  const parsed = JSON.parse(await file.text()) as {
    data?: PortableChatPayload;
    chat?: PortableChatPayload["chat"];
    messages?: unknown[];
  };
  const payload = parsed.data ?? parsed;
  const messages = Array.isArray(payload.messages)
    ? payload.messages.flatMap(parsePortableMessage)
    : [];
  return {
    title: payload.chat?.title ?? file.name.replace(/\.json$/iu, ""),
    ...(payload.chat?.modelId === undefined
      ? {}
      : { modelId: payload.chat.modelId }),
    messages,
  };
}

interface PortableChatPayload {
  chat?: { title?: string; modelId?: string };
  messages?: unknown[];
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

function parsePortableMessage(raw: unknown): PortableMessage[] {
  if (typeof raw !== "object" || raw === null) return [];
  const item = raw as Record<string, unknown>;
  const role = item.role;
  const content = item.content;
  if (
    (role !== "system" &&
      role !== "user" &&
      role !== "assistant" &&
      role !== "tool") ||
    typeof content !== "string"
  ) {
    return [];
  }
  const citations = parsePortableCitations(item.citations);
  const attachments = parsePortableAttachments(item.attachments);
  return [
    {
      role,
      content,
      ...(typeof item.createdAt === "string"
        ? { createdAt: item.createdAt }
        : {}),
      ...(citations.length === 0 ? {} : { citations }),
      ...(attachments.length === 0 ? {} : { attachments }),
    },
  ];
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
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (typeof raw !== "object" || raw === null) return [];
    const item = raw as Record<string, unknown>;
    if (
      typeof item.chunkId !== "string" ||
      typeof item.documentId !== "string" ||
      typeof item.title !== "string"
    ) {
      return [];
    }
    return [
      {
        chunkId: item.chunkId,
        documentId: item.documentId,
        title: item.title,
        ...(typeof item.sourceUri === "string"
          ? { sourceUri: item.sourceUri }
          : {}),
        ...portableCitationField(item, "sourceType"),
        ...portableCitationField(item, "provider"),
        ...portableCitationField(item, "retrievedAt"),
        ...portableCitationField(item, "accessedAt"),
        ...portableCitationField(item, "publishedAt"),
      },
    ];
  });
}

function portableCitationField(
  item: Record<string, unknown>,
  key: string,
): Record<string, string> {
  return typeof item[key] === "string"
    ? ({ [key]: item[key] } as Record<string, string>)
    : {};
}

function parsePortableAttachments(value: unknown): PortableAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (typeof raw !== "object" || raw === null) return [];
    const item = raw as Record<string, unknown>;
    if (
      typeof item.dataBase64 !== "string" ||
      typeof item.fileName !== "string" ||
      typeof item.mimeType !== "string" ||
      typeof item.sizeBytes !== "number"
    ) {
      return [];
    }
    return [
      {
        dataBase64: item.dataBase64,
        fileName: item.fileName,
        mimeType: item.mimeType,
        sizeBytes: item.sizeBytes,
        ...(typeof item.retainedInContext === "boolean"
          ? { retainedInContext: item.retainedInContext }
          : {}),
      },
    ];
  });
}

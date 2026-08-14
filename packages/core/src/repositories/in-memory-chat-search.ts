import type { SeedData } from "./seed-data";
import type { LegacyMessagePart } from "../domain/entities";
import type {
  AuthorizedChatMessageSearchQuery,
  ChatMessageSearchQueryResult,
} from "../domain/repository";
import { isLegacyAttachmentPart } from "../services/message-part-v1";

export interface ChatContentSearchHit {
  chatId: string;
  messageId?: string;
  snippet: string;
}

export function searchInMemoryChatContent(
  data: SeedData,
  workspaceId: string,
  query: string,
): ChatContentSearchHit[] {
  const needle = query.toLowerCase();
  const results: ChatContentSearchHit[] = [];
  for (const chat of data.chats.filter(
    (item) => item.workspaceId === workspaceId,
  )) {
    if (chat.title.toLowerCase().includes(needle)) {
      results.push({ chatId: chat.id, snippet: chat.title });
      continue;
    }
    const message = data.messages.find(
      (item) =>
        item.chatId === chat.id && item.content.toLowerCase().includes(needle),
    );
    if (message !== undefined) {
      const index = message.content.toLowerCase().indexOf(needle);
      results.push({
        chatId: chat.id,
        messageId: message.id,
        snippet: message.content.slice(
          Math.max(0, index - 60),
          index + needle.length + 100,
        ),
      });
      continue;
    }
    const attachment = data.messageParts.find((part) => {
      const parent = data.messages.find(
        (item) => item.id === part.messageId && item.chatId === chat.id,
      );
      return (
        parent !== undefined &&
        isLegacyAttachmentPart(part) &&
        typeof part.metadata.fileName === "string" &&
        part.metadata.fileName.toLowerCase().includes(needle)
      );
    }) as (LegacyMessagePart & { type: "attachment" }) | undefined;
    if (attachment !== undefined)
      results.push({
        chatId: chat.id,
        messageId: attachment.messageId,
        snippet: String(attachment.metadata.fileName),
      });
  }
  return results;
}

export function searchInMemoryAuthorizedChatMessages(
  data: SeedData,
  input: AuthorizedChatMessageSearchQuery,
): ChatMessageSearchQueryResult {
  const chat = data.chats.find(
    (item) =>
      item.id === input.chatId &&
      item.orgId === input.orgId &&
      item.workspaceId === input.workspaceId,
  );
  const transcriptVersion = chat?.transcriptVersion ?? "0";
  if (chat === undefined || transcriptVersion !== input.transcriptVersion) {
    return {
      hasMore: false,
      invalidTranscriptVersion: true,
      items: [],
      total: 0,
      transcriptVersion,
    };
  }
  const activePath = activePathIds(data, chat.activeLeafMessageId);
  const matches = data.messages
    .filter((message) => message.chatId === input.chatId)
    .filter((message) =>
      message.content.toLocaleLowerCase().includes(input.normalizedQuery),
    )
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.id.localeCompare(right.id),
    );
  const afterCursor = matches.filter(
    (message) =>
      input.cursor === undefined ||
      message.createdAt > input.cursor.createdAt ||
      (message.createdAt === input.cursor.createdAt &&
        message.id > input.cursor.id),
  );
  const selected = afterCursor.slice(0, input.limit);
  const hasMore = afterCursor.length > input.limit;
  const last = selected.at(-1);
  return {
    hasMore,
    items: selected.map((message) => ({
      activeBranch:
        chat.activeLeafMessageId === undefined || activePath.has(message.id),
      createdAt: message.createdAt,
      messageId: message.id,
      role: message.role,
      snippet: searchSnippet(message.content, input.normalizedQuery),
    })),
    total: matches.length,
    transcriptVersion,
    ...(hasMore && last !== undefined
      ? { nextPosition: { createdAt: last.createdAt, id: last.id } }
      : {}),
  };
}

function activePathIds(
  data: SeedData,
  leafId: string | undefined,
): Set<string> {
  const path = new Set<string>();
  let currentId = leafId;
  while (currentId !== undefined && !path.has(currentId)) {
    path.add(currentId);
    currentId = data.messages.find(
      (message) => message.id === currentId,
    )?.parentId;
  }
  return path;
}

export function searchSnippet(
  content: string,
  normalizedQuery: string,
): string {
  const index = content.toLocaleLowerCase().indexOf(normalizedQuery);
  const start = Math.max(0, index - 80);
  const body = content
    .slice(start, start + 240)
    .replace(/\s+/gu, " ")
    .trim();
  return `${start > 0 ? "…" : ""}${body}${
    start + 240 < content.length ? "…" : ""
  }`;
}

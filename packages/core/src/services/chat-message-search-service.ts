import type { AuthSubject } from "@romeo/auth";

import type { Message } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { getAuthorizedChat } from "./chat-access";
import {
  createPageCursorCodec,
  InvalidPageCursorError,
  type PageCursorCodec,
} from "./page-cursor";

const defaultCursorSecret = "romeo-chat-message-search-test-secret-v1";

interface CursorPosition {
  createdAt: string;
  id: string;
  transcriptVersion: string;
}

export interface ChatMessageSearchResult {
  data: Array<{
    branch: "active" | "alternate";
    branchLeafMessageId: string;
    createdAt: string;
    messageId: string;
    role: Message["role"];
    snippet: string;
  }>;
  meta: {
    hasMore: boolean;
    limit: number;
    nextCursor?: string;
    total: number;
    transcriptVersion: string;
  };
}

export class ChatMessageSearchService {
  private readonly cursor: PageCursorCodec;

  constructor(
    private readonly repository: RomeoRepository,
    cursorSecrets: readonly [string, ...string[]] = [defaultCursorSecret],
  ) {
    this.cursor = createPageCursorCodec({
      maxAgeSeconds: 86_400,
      resource: "chat-message-search",
      secrets: cursorSecrets,
    });
  }

  async search(input: {
    chatId: string;
    cursor?: string;
    limit: number;
    query: string;
    subject: AuthSubject;
  }): Promise<ChatMessageSearchResult> {
    const normalizedQuery = normalizeChatMessageSearchQuery(input.query);
    if (
      normalizedQuery.length < 2 ||
      normalizedQuery.length > 200 ||
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 50
    ) {
      throw new ApiError(
        "invalid_request",
        "Message search query or page size is invalid.",
        400,
      );
    }
    const chat = await getAuthorizedChat(this.repository, {
      chatId: input.chatId,
      permission: "read",
      scope: "chats:read",
      subject: input.subject,
    });
    const context = {
      filter: {
        chatId: chat.id,
        normalizedQuery,
        orgId: chat.orgId,
        workspaceId: chat.workspaceId,
      },
      sort: { direction: "oldest", limit: input.limit },
    };
    const position = this.decodePosition(input.cursor, context);
    const transcriptVersion =
      position?.transcriptVersion ?? chat.transcriptVersion ?? "0";
    if ((chat.transcriptVersion ?? "0") !== transcriptVersion)
      throw resetRequired();
    const page = await this.repository.searchAuthorizedChatMessages({
      chatId: chat.id,
      limit: input.limit,
      normalizedQuery,
      orgId: chat.orgId,
      transcriptVersion,
      workspaceId: chat.workspaceId,
      ...(position === undefined
        ? {}
        : { cursor: { createdAt: position.createdAt, id: position.id } }),
    });
    if (
      page.invalidTranscriptVersion === true ||
      page.transcriptVersion !== transcriptVersion
    )
      throw resetRequired();
    const nextCursor = this.encodeNext(
      page.nextPosition,
      transcriptVersion,
      context,
    );
    return {
      data: page.items.map((item) => ({
        branch: item.activeBranch ? "active" : "alternate",
        branchLeafMessageId: item.messageId,
        createdAt: item.createdAt,
        messageId: item.messageId,
        role: item.role,
        snippet: item.snippet,
      })),
      meta: {
        hasMore: page.hasMore,
        limit: input.limit,
        ...(nextCursor === undefined ? {} : { nextCursor }),
        total: page.total,
        transcriptVersion,
      },
    };
  }

  private decodePosition(
    token: string | undefined,
    context: { filter: unknown; sort: unknown },
  ): CursorPosition | undefined {
    if (token === undefined) return undefined;
    try {
      return this.cursor.decode(token, context, validatePosition);
    } catch (error) {
      if (error instanceof InvalidPageCursorError) throw invalidCursor();
      throw error;
    }
  }

  private encodeNext(
    position: { createdAt: string; id: string } | undefined,
    transcriptVersion: string,
    context: { filter: unknown; sort: unknown },
  ): string | undefined {
    return position === undefined
      ? undefined
      : this.cursor.encode({
          ...context,
          position: { ...position, transcriptVersion },
        });
  }
}

export function normalizeChatMessageSearchQuery(query: string): string {
  return query.normalize("NFKC").trim().toLocaleLowerCase();
}

function validatePosition(value: unknown): CursorPosition | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const position = value as Record<string, unknown>;
  return typeof position.createdAt === "string" &&
    !Number.isNaN(Date.parse(position.createdAt)) &&
    typeof position.id === "string" &&
    position.id.length > 0 &&
    typeof position.transcriptVersion === "string" &&
    /^[0-9]{1,20}$/u.test(position.transcriptVersion)
    ? (position as unknown as CursorPosition)
    : undefined;
}

function invalidCursor(): ApiError {
  return new ApiError(
    "invalid_page_cursor",
    "The message search cursor is invalid or expired.",
    400,
  );
}

function resetRequired(): ApiError {
  return new ApiError(
    "message_page_reset_required",
    "The conversation changed while searching. Restart the search.",
    409,
  );
}

import type { AuthSubject } from "@romeo/auth";

import type { Message } from "../domain/entities";
import type {
  MessageBranchVariantNavigation,
  MessagePageQueryResult,
  RomeoRepository,
} from "../domain/repository";
import { ApiError } from "../errors";
import { getAuthorizedChat } from "./chat-access";
import { attachMessagePartsBatch } from "./message-attachments";
import {
  createPageCursorCodec,
  InvalidPageCursorError,
  type PageCursorCodec,
} from "./page-cursor";

const defaultCursorSecret = "romeo-chat-message-page-test-secret-v1";

type CursorPosition =
  | {
      branchLeafMessageId: null;
      createdAt: string;
      id: string;
      mode: "linear";
      transcriptVersion: string;
    }
  | {
      branchLeafMessageId: string;
      expectedChildId: string;
      expectedParentId: string | null;
      messageId: string;
      mode: "branch";
      transcriptVersion: string;
      traversed: number;
    };

export interface ChatMessagePage {
  data: Message[];
  meta: {
    activeBranchChanged: boolean;
    branchVariants: MessageBranchVariantNavigation[];
    branchLeafMessageId?: string;
    currentActiveLeafMessageId?: string;
    direction: "older";
    hasOlder: boolean;
    limit: number;
    mode: "branch" | "linear";
    olderCursor?: string;
    transcriptVersion: string;
  };
}

export class ChatMessagePageService {
  private readonly cursor: PageCursorCodec;

  constructor(
    private readonly repository: RomeoRepository,
    cursorSecrets: readonly [string, ...string[]] = [defaultCursorSecret],
  ) {
    this.cursor = createPageCursorCodec({
      maxAgeSeconds: 86_400,
      resource: "chat-message-page",
      secrets: cursorSecrets,
    });
  }

  async list(input: {
    branchLeafMessageId?: string;
    chatId: string;
    cursor?: string;
    direction: "older";
    limit: number;
    subject: AuthSubject;
  }): Promise<ChatMessagePage> {
    const chat = await getAuthorizedChat(this.repository, {
      chatId: input.chatId,
      permission: "read",
      scope: "chats:read",
      subject: input.subject,
    });
    const context = {
      filter: {
        chatId: chat.id,
        orgId: chat.orgId,
        workspaceId: chat.workspaceId,
      },
      sort: {
        direction: input.direction,
        limit: input.limit,
        scope: "active_branch",
      },
    };
    const position = this.decodePosition(input.cursor, context);
    const snapshotVersion =
      position?.transcriptVersion ?? chat.transcriptVersion ?? "0";
    const snapshotLeaf =
      position === undefined
        ? (input.branchLeafMessageId ?? chat.activeLeafMessageId)
        : (position.branchLeafMessageId ?? undefined);
    if (
      position !== undefined &&
      input.branchLeafMessageId !== undefined &&
      position.branchLeafMessageId !== input.branchLeafMessageId
    ) {
      throw invalidCursor();
    }
    if (
      position !== undefined &&
      (chat.transcriptVersion ?? "0") !== snapshotVersion
    )
      throw resetRequired();
    const mode =
      position?.mode ?? (snapshotLeaf === undefined ? "linear" : "branch");
    if (mode === "branch" && snapshotLeaf === undefined) throw resetRequired();
    const page = await this.repository.queryAuthorizedMessagesPage({
      chatId: chat.id,
      limit: input.limit,
      mode,
      orgId: chat.orgId,
      transcriptVersion: snapshotVersion,
      workspaceId: chat.workspaceId,
      ...(mode === "linear"
        ? position?.mode === "linear"
          ? { linearCursor: { createdAt: position.createdAt, id: position.id } }
          : {}
        : {
            branchLeafMessageId: snapshotLeaf as string,
            ...(position?.mode === "branch"
              ? {
                  branchExpectedChildId: position.expectedChildId,
                  branchExpectedParentId: position.expectedParentId,
                  branchStartMessageId: position.messageId,
                  branchTraversalOffset: position.traversed,
                }
              : {}),
          }),
    });
    if (
      page.invalidBranch === true ||
      page.invalidTranscriptVersion === true ||
      page.transcriptVersion !== snapshotVersion
    )
      throw resetRequired();
    const messages = await attachMessagePartsBatch(this.repository, page.items);
    const next = this.encodeNext(page, snapshotLeaf, snapshotVersion, context);
    const currentLeaf = chat.activeLeafMessageId;
    return {
      data: messages,
      meta: {
        activeBranchChanged: currentLeaf !== snapshotLeaf,
        branchVariants: page.branchVariants,
        ...(snapshotLeaf === undefined
          ? {}
          : { branchLeafMessageId: snapshotLeaf }),
        ...(currentLeaf === undefined
          ? {}
          : { currentActiveLeafMessageId: currentLeaf }),
        direction: "older",
        hasOlder: page.hasMore,
        limit: input.limit,
        mode,
        ...(next === undefined ? {} : { olderCursor: next }),
        transcriptVersion: snapshotVersion,
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
    page: MessagePageQueryResult,
    snapshotLeaf: string | undefined,
    transcriptVersion: string,
    context: { filter: unknown; sort: unknown },
  ): string | undefined {
    const next = page.nextPosition;
    if (!page.hasMore || next === undefined) return undefined;
    const position: CursorPosition =
      next.mode === "linear"
        ? { ...next, branchLeafMessageId: null, transcriptVersion }
        : {
            ...next,
            branchLeafMessageId: snapshotLeaf ?? "",
            transcriptVersion,
          };
    if (position.mode === "branch" && position.branchLeafMessageId.length === 0)
      throw resetRequired();
    return this.cursor.encode({ ...context, position });
  }
}

function validatePosition(value: unknown): CursorPosition | undefined {
  if (!isRecord(value)) return undefined;
  if (
    value.mode === "linear" &&
    value.branchLeafMessageId === null &&
    typeof value.createdAt === "string" &&
    !Number.isNaN(Date.parse(value.createdAt)) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    isTranscriptVersion(value.transcriptVersion)
  ) {
    return value as unknown as CursorPosition;
  }
  if (
    value.mode === "branch" &&
    typeof value.branchLeafMessageId === "string" &&
    value.branchLeafMessageId.length > 0 &&
    typeof value.expectedChildId === "string" &&
    value.expectedChildId.length > 0 &&
    (value.expectedParentId === null ||
      (typeof value.expectedParentId === "string" &&
        value.expectedParentId.length > 0)) &&
    typeof value.messageId === "string" &&
    value.messageId.length > 0 &&
    isTranscriptVersion(value.transcriptVersion) &&
    Number.isSafeInteger(value.traversed) &&
    (value.traversed as number) >= 1 &&
    (value.traversed as number) <= 100_000
  ) {
    return value as unknown as CursorPosition;
  }
  return undefined;
}

function isTranscriptVersion(value: unknown): value is string {
  return typeof value === "string" && /^[0-9]{1,20}$/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidCursor(): ApiError {
  return new ApiError(
    "invalid_page_cursor",
    "The message page cursor is invalid or expired.",
    400,
  );
}

function resetRequired(): ApiError {
  return new ApiError(
    "message_page_reset_required",
    "The conversation changed while paging. Restart from the active branch.",
    409,
  );
}

import {
  AuthorizationError,
  assertScope,
  hasWorkspaceAccess,
  type AuthSubject,
} from "@romeo/auth";
import { disabledObjectStore, type ObjectStore } from "@romeo/storage";

import type {
  Chat,
  DataDeletionPreview,
  DataDeletionResult,
  Message,
  MessageFeedbackState,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { writeAuditLog } from "./audit-log";
import { canReadChat, getAuthorizedChat } from "./chat-access";
import { ChatAttachmentService } from "./chat-attachment-service";
import { ChatFeedbackService } from "./chat-feedback-service";
import type { FileMalwareScanner, FileMalwareScanPolicy } from "./file-service";
import { ChatLifecycleService } from "./chat-lifecycle-service";
import {
  ChatMessagePageService,
  type ChatMessagePage,
} from "./chat-message-page-service";
import {
  ChatMessageSearchService,
  type ChatMessageSearchResult,
} from "./chat-message-search-service";
import { attachMessageParts } from "./message-attachments";
import { ChatTemporaryService } from "./chat-temporary-service";
import {
  ChatTransferService,
  type ChatExport,
  type ChatImportInput,
} from "./chat-transfer-service";

export class ChatService {
  private readonly attachments: ChatAttachmentService;
  private readonly feedback: ChatFeedbackService;
  private readonly lifecycle: ChatLifecycleService;
  private readonly messagePages: ChatMessagePageService;
  private readonly messageSearch: ChatMessageSearchService;
  private readonly temporaryChats: ChatTemporaryService;
  private readonly transfer: ChatTransferService;

  constructor(
    private readonly repository: RomeoRepository,
    objectStore: ObjectStore = disabledObjectStore,
    options?: {
      messagePageCursorSecrets?: readonly [string, ...string[]];
      messageSearchCursorSecrets?: readonly [string, ...string[]];
      policy: FileMalwareScanPolicy;
      scanner?: FileMalwareScanner;
    },
  ) {
    this.attachments = new ChatAttachmentService(repository, objectStore);
    this.feedback = new ChatFeedbackService(repository);
    this.lifecycle = new ChatLifecycleService(repository);
    this.messagePages = new ChatMessagePageService(
      repository,
      options?.messagePageCursorSecrets,
    );
    this.messageSearch = new ChatMessageSearchService(
      repository,
      options?.messageSearchCursorSecrets,
    );
    this.temporaryChats = new ChatTemporaryService(repository, objectStore);
    this.transfer = new ChatTransferService(
      repository,
      objectStore,
      this.lifecycle,
      options,
    );
  }

  async list(
    workspaceId: string,
    subject: AuthSubject,
    options: { archived?: "active" | "all" | "archived" } = {},
  ): Promise<Chat[]> {
    assertScope(subject, "chats:read");
    if (!hasWorkspaceAccess(subject, workspaceId)) {
      throw new AuthorizationError(
        "The workspace is outside the caller access.",
      );
    }
    const [chats, grants] = await Promise.all([
      this.repository.listChats(workspaceId),
      this.repository.listResourceGrants(subject.orgId),
    ]);
    const now = Date.now();
    for (const chat of chats) {
      if (
        chat.temporary !== true ||
        chat.expiresAt === undefined ||
        Date.parse(chat.expiresAt) > now
      ) {
        continue;
      }
      if ((await this.temporaryChats.purge(chat)) === "deleted") {
        await writeAuditLog(this.repository, {
          subject,
          action: "chat.temporary.expired",
          resourceType: "chat",
          resourceId: chat.id,
          metadata: { workspaceId: chat.workspaceId },
        });
      }
    }
    const archived = options.archived ?? "active";
    return chats
      .filter(
        (chat) =>
          chat.expiresAt === undefined || Date.parse(chat.expiresAt) > now,
      )
      .filter((chat) => {
        if (archived === "all") return true;
        if (archived === "archived") return chat.archivedAt !== undefined;
        return chat.archivedAt === undefined;
      })
      .filter((chat) => canReadChat(subject, grants, chat));
  }

  async listPage(
    workspaceId: string,
    subject: AuthSubject,
    options: {
      archived?: "active" | "all" | "archived";
      limit: number;
      offset: number;
    },
  ): Promise<{ items: Chat[]; limit: number; offset: number; total: number }> {
    assertScope(subject, "chats:read");
    if (!hasWorkspaceAccess(subject, workspaceId)) {
      throw new AuthorizationError(
        "The workspace is outside the caller access.",
      );
    }
    const page = await this.repository.listAuthorizedChatsPage({
      archived: options.archived ?? "active",
      groupIds: subject.groupIds,
      isAdmin: subject.isAdmin === true,
      limit: options.limit,
      now: new Date().toISOString(),
      offset: options.offset,
      orgId: subject.orgId,
      principalId: subject.id,
      principalType: subject.type,
      workspaceId,
    });
    return {
      items: page.items,
      limit: options.limit,
      offset: options.offset,
      total: page.total,
    };
  }

  get(chatId: string, subject: AuthSubject): Promise<Chat> {
    return getAuthorizedChat(this.repository, {
      chatId,
      subject,
      scope: "chats:read",
      permission: "read",
    });
  }

  async messages(chatId: string, subject: AuthSubject) {
    await this.get(chatId, subject);
    return attachMessageParts(
      this.repository,
      await this.repository.listMessages(chatId),
    );
  }

  messagePage(input: {
    branchLeafMessageId?: string;
    chatId: string;
    cursor?: string;
    direction: "older";
    limit: number;
    subject: AuthSubject;
  }): Promise<ChatMessagePage> {
    return this.messagePages.list(input);
  }

  searchMessages(input: {
    chatId: string;
    cursor?: string;
    limit: number;
    query: string;
    subject: AuthSubject;
  }): Promise<ChatMessageSearchResult> {
    return this.messageSearch.search(input);
  }

  messageFeedback(input: {
    chatId: string;
    messageId: string;
    subject: AuthSubject;
  }): Promise<MessageFeedbackState> {
    return this.feedback.get(input);
  }

  messageFeedbackList(
    chatId: string,
    subject: AuthSubject,
  ): Promise<MessageFeedbackState[]> {
    return this.feedback.list(chatId, subject);
  }

  updateMessageFeedback(input: {
    chatId: string;
    messageId: string;
    rating: "negative" | "none" | "positive";
    reasonCode?: string;
    subject: AuthSubject;
  }): Promise<MessageFeedbackState> {
    return this.feedback.update(input);
  }

  deleteMessage(input: {
    chatId: string;
    messageId: string;
    subject: AuthSubject;
  }): Promise<Message> {
    return this.attachments.deleteMessage(input);
  }

  readAttachment(input: {
    attachmentId: string;
    chatId: string;
    messageId: string;
    subject: AuthSubject;
  }) {
    return this.attachments.read(input);
  }

  readAttachmentTextPreview(input: {
    attachmentId: string;
    chatId: string;
    messageId: string;
    subject: AuthSubject;
  }): Promise<{ content: string; fileName: string }> {
    return this.attachments.readTextPreview(input);
  }

  updateAttachmentRetention(input: {
    attachmentId: string;
    chatId: string;
    messageId: string;
    retainedInContext: boolean;
    subject: AuthSubject;
  }) {
    return this.attachments.updateRetention(input);
  }

  create(input: {
    workspaceId: string;
    title: string;
    subject: AuthSubject;
    temporary?: boolean;
    expiresAt?: string;
  }): Promise<Chat> {
    return this.lifecycle.create(input);
  }

  async search(input: {
    workspaceId: string;
    query: string;
    subject: AuthSubject;
  }): Promise<
    Array<Chat & { match?: { messageId: string; snippet: string } }>
  > {
    const query = input.query.trim().toLowerCase();
    const chats = await this.list(input.workspaceId, input.subject, {
      archived: "all",
    });
    if (query.length === 0) return chats;
    const matches = new Map(
      (await this.repository.searchChatContent(input.workspaceId, query)).map(
        (match) => [match.chatId, match],
      ),
    );
    return chats.flatMap((chat) => {
      const match = matches.get(chat.id);
      if (match === undefined) return [];
      return [
        {
          ...chat,
          ...(match.messageId === undefined
            ? {}
            : {
                match: { messageId: match.messageId, snippet: match.snippet },
              }),
        },
      ];
    });
  }

  cleanupExpiredTemporaryChats(input: {
    subject: AuthSubject;
    workspaceId?: string;
  }): Promise<{ deletedChatIds: string[]; skippedLegalHoldIds: string[] }> {
    return this.temporaryChats.cleanup(input);
  }

  cleanupExpiredTemporaryChatsForWorker(input: {
    orgId: string;
    batchSize: number;
    now?: string;
  }): Promise<{
    scanned: number;
    deletedChatIds: string[];
    skippedLegalHoldIds: string[];
    deletedObjectCount: number;
  }> {
    return this.temporaryChats.cleanupForWorker(input);
  }

  exportChat(input: {
    chatId: string;
    subject: AuthSubject;
  }): Promise<ChatExport> {
    return this.transfer.export(input);
  }

  importChat(input: ChatImportInput): Promise<Chat> {
    return this.transfer.import(input);
  }

  update(input: {
    activeLeafMessageId?: string;
    chatId: string;
    subject: AuthSubject;
    title?: string;
    modelId?: string | null;
  }): Promise<Chat> {
    return this.lifecycle.update(input);
  }

  archive(input: { chatId: string; subject: AuthSubject }): Promise<Chat> {
    return this.lifecycle.archive(input);
  }

  deletePreview(input: {
    chatId: string;
    subject: AuthSubject;
  }): Promise<DataDeletionPreview> {
    return this.lifecycle.deletePreview(input);
  }

  delete(input: {
    chatId: string;
    confirmChatId: string;
    subject: AuthSubject;
  }): Promise<DataDeletionResult> {
    return this.lifecycle.delete(input);
  }

  fork(input: {
    chatId: string;
    includeAttachments?: boolean;
    subject: AuthSubject;
    throughMessageId?: string;
    title?: string;
  }): Promise<Chat> {
    return this.transfer.fork(input);
  }

  unarchive(input: { chatId: string; subject: AuthSubject }): Promise<Chat> {
    return this.lifecycle.unarchive(input);
  }

  updateLegalHold(input: {
    chatId: string;
    subject: AuthSubject;
    legalHoldUntil?: string | null;
    legalHoldReason?: string;
  }): Promise<Chat> {
    return this.lifecycle.updateLegalHold(input);
  }
}

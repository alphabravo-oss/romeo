import { assertScope, type AuthSubject } from "@romeo/auth";
import type { ObjectStore } from "@romeo/storage";

import type { Chat, Message, MessagePart } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { notFound } from "../errors";
import { createId } from "../ids";
import { writeAuditLog } from "./audit-log";
import { getAuthorizedChat } from "./chat-access";
import type { FileMalwareScanner, FileMalwareScanPolicy } from "./file-service";
import { ChatLifecycleService } from "./chat-lifecycle-service";
import {
  attachMessageParts,
  readMessageAttachment,
  storeMessageAttachments,
} from "./message-attachments";
import { persistedSubjectActorId } from "./subject-persisted-actor";
import { assertWorkspaceActive } from "./workspace-guard";

export interface ChatImportInput {
  workspaceId: string;
  title?: string;
  modelId?: string;
  messages: Array<{
    role: Message["role"];
    content: string;
    createdAt?: string;
    citations?: Message["citations"];
    attachments?: Array<{
      dataBase64: string;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      retainedInContext?: boolean;
    }>;
  }>;
  subject: AuthSubject;
}

export interface ChatExport {
  schema: "romeo.chat-export.v1";
  exportedAt: string;
  chat: Chat;
  messages: Array<
    Omit<Message, "attachments"> & {
      attachments?: Array<
        NonNullable<Message["attachments"]>[number] & { dataBase64: string }
      >;
    }
  >;
}

export class ChatTransferService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly objectStore: ObjectStore,
    private readonly lifecycle: ChatLifecycleService,
    private readonly malwareScanning?: {
      policy: FileMalwareScanPolicy;
      scanner?: FileMalwareScanner;
    },
  ) {}

  async export(input: {
    chatId: string;
    subject: AuthSubject;
  }): Promise<ChatExport> {
    const chat = await getAuthorizedChat(this.repository, {
      chatId: input.chatId,
      subject: input.subject,
      scope: "chats:read",
      permission: "read",
    });
    const sourceMessages = await attachMessageParts(
      this.repository,
      await this.repository.listMessages(chat.id),
    );
    const messages = await Promise.all(
      sourceMessages.map(async (message) => {
        const { attachments: sourceAttachments, ...base } = message;
        if (sourceAttachments === undefined || sourceAttachments.length === 0) {
          return base;
        }
        const attachments = await Promise.all(
          sourceAttachments.map(async (attachment) => {
            const stored = await readMessageAttachment({
              attachmentId: attachment.id,
              chatId: chat.id,
              messageId: message.id,
              objectStore: this.objectStore,
              repository: this.repository,
              subject: input.subject,
            });
            return {
              ...attachment,
              dataBase64: Buffer.from(stored.bytes).toString("base64"),
            };
          }),
        );
        return { ...base, attachments };
      }),
    );
    await this.audit(input.subject, "chat.export", chat, {
      messageCount: messages.length,
    });
    return {
      schema: "romeo.chat-export.v1",
      exportedAt: new Date().toISOString(),
      chat,
      messages,
    };
  }

  async import(input: ChatImportInput): Promise<Chat> {
    const chat = await this.lifecycle.create({
      workspaceId: input.workspaceId,
      title: input.title?.trim() || "Imported conversation",
      subject: input.subject,
    });
    const importedChat =
      input.modelId === undefined
        ? chat
        : await this.lifecycle.update({
            chatId: chat.id,
            modelId: input.modelId,
            subject: input.subject,
          });
    await this.repository.transaction(async (repository) => {
      for (const message of input.messages) {
        const created = await repository.createMessage({
          id: createId("msg"),
          chatId: chat.id,
          role: message.role,
          content: message.content,
          ...(message.citations === undefined
            ? {}
            : { citations: message.citations }),
          createdAt: message.createdAt ?? new Date().toISOString(),
        });
        const parts = await storeMessageAttachments({
          messageId: created.id,
          objectStore: this.objectStore,
          ...(this.malwareScanning === undefined
            ? {}
            : { malwareScanning: this.malwareScanning }),
          ...(message.attachments === undefined
            ? {}
            : { attachments: message.attachments }),
        });
        if (parts.length > 0) await repository.createMessageParts(parts);
      }
      await this.audit(
        input.subject,
        "chat.import",
        chat,
        { messageCount: input.messages.length },
        repository,
      );
    });
    return importedChat;
  }

  async fork(input: {
    chatId: string;
    includeAttachments?: boolean;
    subject: AuthSubject;
    throughMessageId?: string;
    title?: string;
  }): Promise<Chat> {
    assertScope(input.subject, "chats:write");
    const source = await getAuthorizedChat(this.repository, {
      chatId: input.chatId,
      subject: input.subject,
      scope: "chats:read",
      permission: "read",
    });
    await assertWorkspaceActive(this.repository, {
      orgId: source.orgId,
      workspaceId: source.workspaceId,
    });
    const includeAttachments = input.includeAttachments !== false;
    const title = normalizedForkTitle(input.title, source.title);
    const sourceMessages = await this.repository.listMessages(source.id);
    const messagesToCopy =
      input.throughMessageId === undefined
        ? sourceMessages
        : sourceMessages.slice(
            0,
            selectedMessageIndex(sourceMessages, input.throughMessageId) + 1,
          );
    const now = new Date().toISOString();
    const createdBy = await persistedSubjectActorId(
      this.repository,
      input.subject,
      {
        kind: "service_account_chat_owner",
        name: "Service Account Chat Owner",
      },
    );
    return this.repository.transaction(async (repository) => {
      const chat = await repository.createChat({
        id: createId("chat"),
        orgId: source.orgId,
        workspaceId: source.workspaceId,
        title,
        createdBy,
        updatedAt: now,
      });
      await this.lifecycle.createOwnerGrants(
        input.subject,
        chat.id,
        repository,
      );
      let copiedAttachmentCount = 0;
      for (const message of messagesToCopy) {
        const copiedMessage = await repository.createMessage(
          copyMessage(message, chat.id),
        );
        if (!includeAttachments) continue;
        const copiedParts = copyAttachmentParts(
          await repository.listMessageParts(message.id),
          copiedMessage.id,
        );
        copiedAttachmentCount += copiedParts.length;
        if (copiedParts.length > 0) {
          await repository.createMessageParts(copiedParts);
        }
      }
      await this.audit(
        input.subject,
        "chat.fork",
        chat,
        {
          sourceChatId: source.id,
          throughMessageIdConfigured: input.throughMessageId !== undefined,
          copiedMessageCount: messagesToCopy.length,
          copiedAttachmentCount,
          includedAttachments: includeAttachments,
        },
        repository,
      );
      return chat;
    });
  }

  private async audit(
    subject: AuthSubject,
    action: string,
    chat: Chat,
    metadata: Record<string, unknown>,
    repository: RomeoRepository = this.repository,
  ) {
    await writeAuditLog(repository, {
      subject,
      action,
      resourceType: "chat",
      resourceId: chat.id,
      metadata: { workspaceId: chat.workspaceId, ...metadata },
    });
  }
}

function normalizedForkTitle(title: string | undefined, sourceTitle: string) {
  const normalized = title?.trim();
  if (normalized !== undefined && normalized.length > 0) return normalized;
  const fallback = `Fork of ${sourceTitle.trim() || "Untitled chat"}`;
  return fallback.length <= 200 ? fallback : fallback.slice(0, 200);
}

function selectedMessageIndex(messages: Message[], messageId: string): number {
  const index = messages.findIndex((message) => message.id === messageId);
  if (index < 0) throw notFound("Message");
  return index;
}

function copyMessage(message: Message, chatId: string): Message {
  return {
    id: createId("msg"),
    chatId,
    role: message.role,
    content: message.content,
    createdAt: message.createdAt,
  };
}

function copyAttachmentParts(
  parts: MessagePart[],
  messageId: string,
): MessagePart[] {
  return parts
    .filter((part) => part.type === "attachment")
    .map((part) => ({
      id: createId("msg_part"),
      messageId,
      type: "attachment",
      content: part.content,
      metadata: { ...part.metadata },
    }));
}

import {
  AuthorizationError,
  assertScope,
  hasWorkspaceAccess,
  type AuthSubject,
} from "@romeo/auth";
import type { MessagePart as TransferMessagePart } from "@romeo/contracts";
import type { ObjectStore } from "@romeo/storage";

import type { Chat, Message, MessagePart } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { notFound } from "../errors";
import { createId } from "../ids";
import {
  type AuditAction,
  type AuditMetadata,
  writeAuditLog,
} from "./audit-log";
import { getAuthorizedChat } from "./chat-access";
import type { FileMalwareScanner, FileMalwareScanPolicy } from "./file-service";
import { ChatLifecycleService } from "./chat-lifecycle-service";
import { enforceContentPolicyStrings } from "./content-policy-service";
import {
  attachMessageParts,
  readMessageAttachment,
  storeMessageAttachments,
} from "./message-attachments";
import { advanceChatLeaf } from "./run-command-service";
import { persistedSubjectActorId } from "./subject-persisted-actor";
import {
  assertImportTextMatchesContent,
  assertTransferPartsImportable,
  copyAttachmentParts,
  materializeTransferParts,
  portableTransferParts,
} from "./chat-transfer-message-parts";
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
    parts?: TransferMessagePart[];
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
    Omit<Message, "attachments" | "parts"> & {
      parts?: TransferMessagePart[];
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
        const {
          attachments: sourceAttachments,
          parts: sourceParts,
          ...base
        } = message;
        const parts = await portableTransferParts({
          parts: sourceParts ?? [],
          repository: this.repository,
          subject: input.subject,
          workspaceId: chat.workspaceId,
        });
        const fileRefPartIds = new Set(
          (sourceParts ?? [])
            .filter((part) => "schemaVersion" in part && part.schemaVersion === 1)
            .filter((part) => part.type !== "text")
            .map((part) => part.id),
        );
        const portableAttachments = (sourceAttachments ?? []).filter(
          (attachment) => !fileRefPartIds.has(attachment.id),
        );
        if (portableAttachments.length === 0) {
          return { ...base, ...(parts.length === 0 ? {} : { parts }) };
        }
        const attachments = await Promise.all(
          portableAttachments.map(async (attachment) => {
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
        return {
          ...base,
          attachments,
          ...(parts.length === 0 ? {} : { parts }),
        };
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
    assertScope(input.subject, "chats:write");
    if (!hasWorkspaceAccess(input.subject, input.workspaceId)) {
      throw new AuthorizationError(
        "The workspace is outside the caller access.",
      );
    }
    await assertWorkspaceActive(this.repository, {
      orgId: input.subject.orgId,
      workspaceId: input.workspaceId,
    });
    const governed = await enforceContentPolicyStrings(
      this.repository,
      input.subject,
      input.messages.map((message) => message.content),
    );
    assertImportTextMatchesContent(input.messages);
    await Promise.all(
      input.messages.map((message) =>
        assertTransferPartsImportable({
          parts: message.parts ?? [],
          repository: this.repository,
          subject: input.subject,
          workspaceId: input.workspaceId,
        }),
      ),
    );
    const importedMessages = input.messages.map((message, index) => ({
      ...message,
      content: governed.contents[index]!,
    }));
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
    // An export carries no parent links, so the import is chained: without one the first turn sent
    // afterwards would attach at the root and hide the whole imported conversation.
    let previousId: string | undefined;
    await this.repository.transaction(async (repository) => {
      for (const message of importedMessages) {
        const created = await repository.createMessage({
          id: createId("msg"),
          chatId: chat.id,
          role: message.role,
          content: message.content,
          ...(message.citations === undefined
            ? {}
            : { citations: message.citations }),
          ...(previousId === undefined ? {} : { parentId: previousId }),
          createdAt: message.createdAt ?? new Date().toISOString(),
        });
        previousId = created.id;
        const legacyParts = await storeMessageAttachments({
          messageId: created.id,
          objectStore: this.objectStore,
          ...(this.malwareScanning === undefined
            ? {}
            : { malwareScanning: this.malwareScanning }),
          ...(message.attachments === undefined
            ? {}
            : { attachments: message.attachments }),
        });
        const typedParts = await materializeTransferParts({
          createdAt: created.createdAt,
          messageId: created.id,
          parts: message.parts ?? [],
          positionOffset: 1 + legacyParts.length,
          repository,
          subject: input.subject,
          workspaceId: chat.workspaceId,
        });
        const parts = [...legacyParts, ...typedParts];
        if (parts.length > 0) await repository.createMessageParts(parts);
      }
      if (previousId !== undefined)
        await advanceChatLeaf(repository, chat.id, previousId);
      await this.audit(
        input.subject,
        "chat.import",
        chat,
        { messageCount: importedMessages.length },
        repository,
      );
    });
    return previousId === undefined
      ? importedChat
      : { ...importedChat, activeLeafMessageId: previousId };
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
      // A branched source would otherwise copy as a parentless heap, which renders every branch
      // flattened into one thread. Remapping keeps the fork's tree the same shape as the source's.
      const copiedIds = new Map<string, string>();
      for (const message of messagesToCopy) {
        const copiedMessage = await repository.createMessage(
          copyMessage(message, chat.id, copiedIds),
        );
        copiedIds.set(message.id, copiedMessage.id);
        if (!includeAttachments) continue;
        const sourceParts = await repository.listMessageParts(message.id);
        const legacyParts = copyAttachmentParts(sourceParts, copiedMessage.id);
        const transferParts = await portableTransferParts({
          parts: sourceParts,
          repository,
          subject: input.subject,
          workspaceId: source.workspaceId,
        });
        const typedParts = await materializeTransferParts({
          createdAt: copiedMessage.createdAt,
          messageId: copiedMessage.id,
          parts: transferParts,
          positionOffset: 1 + legacyParts.length,
          repository,
          subject: input.subject,
          workspaceId: source.workspaceId,
        });
        const copiedParts = [...legacyParts, ...typedParts];
        copiedAttachmentCount += copiedParts.length;
        if (copiedParts.length > 0) {
          await repository.createMessageParts(copiedParts);
        }
      }
      // Forking through a mid-conversation message leaves the source leaf outside the copied slice,
      // so its remap misses. Without the fallback the fork gets no leaf and its first follow-up
      // parents at the root, hiding everything just copied behind a sibling arrow.
      const forkedLeafId =
        (source.activeLeafMessageId === undefined
          ? undefined
          : copiedIds.get(source.activeLeafMessageId)) ??
        copiedIds.get(messagesToCopy.at(-1)?.id ?? "");
      if (forkedLeafId !== undefined)
        await advanceChatLeaf(repository, chat.id, forkedLeafId);
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
      return forkedLeafId === undefined
        ? chat
        : { ...chat, activeLeafMessageId: forkedLeafId };
    });
  }

  private async audit<A extends AuditAction>(
    subject: AuthSubject,
    action: A,
    chat: Chat,
    metadata: AuditMetadata<A>,
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

function copyMessage(
  message: Message,
  chatId: string,
  copiedIds: Map<string, string>,
): Message {
  // A parent outside the copied slice (throughMessageId cut above it) drops, re-rooting the branch
  // rather than pointing at a message this chat does not contain.
  const parentId =
    message.parentId === undefined
      ? undefined
      : copiedIds.get(message.parentId);
  return {
    id: createId("msg"),
    chatId,
    role: message.role,
    content: message.content,
    ...(parentId === undefined ? {} : { parentId }),
    createdAt: message.createdAt,
  };
}

import type { AuthSubject } from "@romeo/auth";
import type { ObjectStore } from "@romeo/storage";

import type { Message } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { writeAuditLog } from "./audit-log";
import { getAuthorizedChat } from "./chat-access";
import { LocalOoxmlTextExtractor } from "./local-ooxml-extractor";
import { readMessageAttachment } from "./message-attachments";

export class ChatAttachmentService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly objectStore: ObjectStore,
  ) {}

  async deleteMessage(input: {
    chatId: string;
    messageId: string;
    subject: AuthSubject;
  }): Promise<Message> {
    const chat = await getAuthorizedChat(this.repository, {
      chatId: input.chatId,
      subject: input.subject,
      scope: "chats:write",
      permission: "write",
    });
    const message = await this.repository.getMessage(input.messageId);
    if (!message || message.chatId !== chat.id) throw notFound("Message");
    const plan = await this.repository.getDataDeletionPlan(
      chat.orgId,
      "chat",
      chat.id,
    );
    if (!plan) throw notFound("Chat");
    if (plan.legalHold !== undefined) {
      throw new ApiError(
        "chat_delete_legal_hold",
        "Chat is under legal hold and cannot be deleted.",
        409,
        { legalHoldUntil: plan.legalHold.until },
      );
    }
    return this.repository.transaction(async (repository) => {
      await repository.deleteMessage(message.id);
      await writeAuditLog(repository, {
        subject: input.subject,
        action: "chat.message.delete",
        resourceType: "chat",
        resourceId: chat.id,
        metadata: {
          workspaceId: chat.workspaceId,
          messageId: message.id,
          messageRole: message.role,
        },
      });
      return message;
    });
  }

  read(input: {
    attachmentId: string;
    chatId: string;
    messageId: string;
    subject: AuthSubject;
  }) {
    return readMessageAttachment({
      ...input,
      repository: this.repository,
      objectStore: this.objectStore,
    });
  }

  async readTextPreview(input: {
    attachmentId: string;
    chatId: string;
    messageId: string;
    subject: AuthSubject;
  }): Promise<{ content: string; fileName: string }> {
    const attachment = await this.read(input);
    if (!isOfficePreviewMimeType(attachment.mimeType)) {
      throw new ApiError(
        "attachment_preview_not_supported",
        "A safe text preview is not available for this attachment type.",
        415,
      );
    }
    const extracted = await new LocalOoxmlTextExtractor().extract({
      bytes: attachment.bytes,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
    });
    return {
      content: extracted.content,
      fileName: `${attachment.fileName}.txt`,
    };
  }

  async updateRetention(input: {
    attachmentId: string;
    chatId: string;
    messageId: string;
    retainedInContext: boolean;
    subject: AuthSubject;
  }) {
    const chat = await getAuthorizedChat(this.repository, {
      chatId: input.chatId,
      subject: input.subject,
      scope: "chats:write",
      permission: "write",
    });
    const message = await this.repository.getMessage(input.messageId);
    if (!message || message.chatId !== chat.id) throw notFound("Message");
    const part = await this.repository.getMessagePart(input.attachmentId);
    if (!part || part.messageId !== message.id || part.type !== "attachment") {
      throw notFound("Message attachment");
    }
    return this.repository.transaction(async (repository) => {
      const updated = await repository.updateMessagePart({
        ...part,
        metadata: {
          ...part.metadata,
          retainedInContext: input.retainedInContext,
        },
      });
      await writeAuditLog(repository, {
        subject: input.subject,
        action: "chat.attachment.retention.update",
        resourceType: "chat",
        resourceId: chat.id,
        metadata: {
          attachmentId: part.id,
          retainedInContext: input.retainedInContext,
          workspaceId: chat.workspaceId,
        },
      });
      return {
        id: updated.id,
        messageId: updated.messageId,
        retainedInContext: input.retainedInContext,
      };
    });
  }
}

function isOfficePreviewMimeType(mimeType: string): boolean {
  return (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType ===
      "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    mimeType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
}

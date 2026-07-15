import {
  AuthorizationError,
  assertScope,
  canAccessOrg,
  hasWorkspaceAccess,
  type AuthSubject,
  type ResourceGrant,
} from "@romeo/auth";
import { disabledObjectStore, type ObjectStore } from "@romeo/storage";

import type {
  Chat,
  DataDeletionPreview,
  DataDeletionResult,
  Message,
  MessageFeedbackState,
  MessagePart,
  UsageEvent,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { writeAuditLog } from "./audit-log";
import { canReadChat, getAuthorizedChat } from "./chat-access";
import {
  attachMessageParts,
  readMessageAttachment,
} from "./message-attachments";
import { persistedSubjectActorId } from "./subject-persisted-actor";
import { assertWorkspaceActive } from "./workspace-guard";

export class ChatService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly objectStore: ObjectStore = disabledObjectStore,
  ) {}

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
    const archived = options.archived ?? "active";
    return chats
      .filter((chat) => {
        if (archived === "all") return true;
        if (archived === "archived") return chat.archivedAt !== undefined;
        return chat.archivedAt === undefined;
      })
      .filter((chat) => canReadChat(subject, grants, chat));
  }

  async get(chatId: string, subject: AuthSubject): Promise<Chat> {
    return getAuthorizedChat(this.repository, {
      chatId,
      subject,
      scope: "chats:read",
      permission: "read",
    });
  }

  async messages(chatId: string, subject: AuthSubject) {
    await getAuthorizedChat(this.repository, {
      chatId,
      subject,
      scope: "chats:read",
      permission: "read",
    });
    return attachMessageParts(
      this.repository,
      await this.repository.listMessages(chatId),
    );
  }

  async messageFeedback(input: {
    chatId: string;
    messageId: string;
    subject: AuthSubject;
  }): Promise<MessageFeedbackState> {
    const { chat, message } = await this.getFeedbackMessageContext(input);
    const actorId = await persistedSubjectActorId(
      this.repository,
      input.subject,
      {
        kind: "service_account_usage",
        name: "Service Account Usage Actor",
      },
    );
    return publicMessageFeedback(
      chat.id,
      message.id,
      await this.latestMessageFeedbackEvent(chat.orgId, message.id, actorId),
    );
  }

  async messageFeedbackList(
    chatId: string,
    subject: AuthSubject,
  ): Promise<MessageFeedbackState[]> {
    const chat = await getAuthorizedChat(this.repository, {
      chatId,
      subject,
      scope: "chats:read",
      permission: "read",
    });
    const actorId = await persistedSubjectActorId(this.repository, subject, {
      kind: "service_account_usage",
      name: "Service Account Usage Actor",
    });
    const feedbackByMessageId = await this.messageFeedbackEventsByMessageId(
      chat.orgId,
      actorId,
    );
    return (await this.repository.listMessages(chat.id))
      .filter((message) => message.role === "assistant")
      .map((message) =>
        publicMessageFeedback(
          chat.id,
          message.id,
          feedbackByMessageId.get(message.id),
        ),
      );
  }

  async updateMessageFeedback(input: {
    chatId: string;
    messageId: string;
    rating: "negative" | "none" | "positive";
    reasonCode?: string;
    subject: AuthSubject;
  }): Promise<MessageFeedbackState> {
    if (input.rating === "none" && input.reasonCode !== undefined) {
      throw new ApiError(
        "invalid_message_feedback",
        "reasonCode is only valid when recording positive or negative feedback.",
        400,
      );
    }
    const { chat, message } = await this.getFeedbackMessageContext(input);
    if (message.role !== "assistant") {
      throw new ApiError(
        "message_feedback_unsupported_role",
        "Only assistant messages can be rated.",
        409,
      );
    }

    const actorId = await persistedSubjectActorId(
      this.repository,
      input.subject,
      {
        kind: "service_account_usage",
        name: "Service Account Usage Actor",
      },
    );
    const existing = await this.latestMessageFeedbackEvent(
      chat.orgId,
      message.id,
      actorId,
    );
    const now = new Date().toISOString();
    const metadata = messageFeedbackMetadata({
      chatId: chat.id,
      configured: input.rating !== "none",
      messageId: message.id,
      rating: input.rating,
      ...(input.reasonCode !== undefined
        ? { reasonCode: input.reasonCode }
        : {}),
      updatedAt: now,
      workspaceId: chat.workspaceId,
    });
    const event =
      existing === undefined
        ? await this.repository.createUsageEvent({
            id: createId("usage"),
            orgId: chat.orgId,
            workspaceId: chat.workspaceId,
            actorId,
            sourceType: "chat",
            sourceId: message.id,
            metric: messageFeedbackMetric,
            quantity: input.rating === "none" ? 0 : 1,
            unit: "feedback",
            metadata,
            createdAt: now,
          })
        : await this.repository.updateUsageEvent({
            ...existing,
            quantity: input.rating === "none" ? 0 : 1,
            unit: "feedback",
            metadata,
          });

    await this.audit(
      input.subject,
      input.rating === "none"
        ? "chat.message_feedback.clear"
        : "chat.message_feedback.record",
      chat.id,
      {
        workspaceId: chat.workspaceId,
        messageId: message.id,
        messageRole: message.role,
        configured: input.rating !== "none",
        rating: input.rating,
        reasonCodeConfigured: input.reasonCode !== undefined,
      },
    );
    return publicMessageFeedback(chat.id, message.id, event);
  }

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
      await this.audit(
        input.subject,
        "chat.message.delete",
        chat.id,
        {
          workspaceId: chat.workspaceId,
          messageId: message.id,
          messageRole: message.role,
        },
        repository,
      );
      return message;
    });
  }

  async readAttachment(input: {
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

  async create(input: {
    workspaceId: string;
    title: string;
    subject: AuthSubject;
  }): Promise<Chat> {
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

    const now = new Date().toISOString();
    const createdBy = await persistedSubjectActorId(
      this.repository,
      input.subject,
      {
        kind: "service_account_chat_owner",
        name: "Service Account Chat Owner",
      },
    );
    const chat = await this.repository.createChat({
      id: createId("chat"),
      orgId: input.subject.orgId,
      workspaceId: input.workspaceId,
      title: input.title,
      createdBy,
      updatedAt: now,
    });
    await this.createOwnerGrants(input.subject, chat.id);
    return chat;
  }

  async update(input: {
    chatId: string;
    subject: AuthSubject;
    title?: string;
  }): Promise<Chat> {
    const chat = await getAuthorizedChat(this.repository, {
      chatId: input.chatId,
      subject: input.subject,
      scope: "chats:write",
      permission: "write",
    });
    const title = input.title?.trim();
    if (title === undefined || title.length === 0) {
      throw new ApiError(
        "invalid_chat_update",
        "A non-empty title is required.",
        400,
      );
    }
    const updatedAt = new Date().toISOString();
    return this.repository.transaction(async (repository) => {
      const updated = await repository.updateChat({
        ...chat,
        title,
        updatedAt,
      });
      await this.audit(
        input.subject,
        "chat.update",
        updated.id,
        {
          workspaceId: updated.workspaceId,
          changedFields: ["title"],
        },
        repository,
      );
      return updated;
    });
  }

  async archive(input: {
    chatId: string;
    subject: AuthSubject;
  }): Promise<Chat> {
    const chat = await getAuthorizedChat(this.repository, {
      chatId: input.chatId,
      subject: input.subject,
      scope: "chats:write",
      permission: "write",
    });
    const archivedAt = new Date().toISOString();
    return this.repository.transaction(async (repository) => {
      const updated = await repository.updateChat({
        ...chat,
        archivedAt,
        updatedAt: archivedAt,
      });
      await this.audit(
        input.subject,
        "chat.archive",
        updated.id,
        {
          workspaceId: updated.workspaceId,
          archivedAt,
        },
        repository,
      );
      return updated;
    });
  }

  async deletePreview(input: {
    chatId: string;
    subject: AuthSubject;
  }): Promise<DataDeletionPreview> {
    const chat = await getAuthorizedChat(this.repository, {
      chatId: input.chatId,
      subject: input.subject,
      scope: "chats:write",
      permission: "write",
    });
    const plan = await this.repository.getDataDeletionPlan(
      chat.orgId,
      "chat",
      chat.id,
    );
    if (!plan) throw notFound("Chat");
    return {
      schema: "romeo.data-deletion-preview.v1",
      ...plan,
      previewedAt: new Date().toISOString(),
    };
  }

  async delete(input: {
    chatId: string;
    confirmChatId: string;
    subject: AuthSubject;
  }): Promise<DataDeletionResult> {
    const chat = await getAuthorizedChat(this.repository, {
      chatId: input.chatId,
      subject: input.subject,
      scope: "chats:write",
      permission: "write",
    });
    if (input.confirmChatId !== chat.id) {
      throw new ApiError(
        "chat_delete_confirmation_mismatch",
        "confirmChatId must exactly match chatId.",
        400,
      );
    }

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

    const deletedAt = new Date().toISOString();
    const deleted = await this.repository.transaction(async (repository) => {
      const deletion = await repository.deleteDataForResource(
        chat.orgId,
        "chat",
        chat.id,
      );
      if (!deletion) throw notFound("Chat");
      await this.audit(
        input.subject,
        "chat.delete",
        chat.id,
        {
          workspaceId: deletion.workspaceId,
          counts: deletion.counts,
          deletionEngine: "governed_data_deletion",
          confirmationMatched: true,
        },
        repository,
      );
      return deletion;
    });
    return {
      schema: "romeo.data-deletion-result.v1",
      ...deleted,
      deletedAt,
    };
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
      await this.createOwnerGrants(input.subject, chat.id, repository);

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
        if (copiedParts.length > 0)
          await repository.createMessageParts(copiedParts);
      }

      await this.audit(
        input.subject,
        "chat.fork",
        chat.id,
        {
          sourceChatId: source.id,
          workspaceId: source.workspaceId,
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

  async unarchive(input: {
    chatId: string;
    subject: AuthSubject;
  }): Promise<Chat> {
    const chat = await getAuthorizedChat(this.repository, {
      chatId: input.chatId,
      subject: input.subject,
      scope: "chats:write",
      permission: "write",
    });
    await assertWorkspaceActive(this.repository, {
      orgId: chat.orgId,
      workspaceId: chat.workspaceId,
    });
    if (chat.archivedAt === undefined) return chat;
    const updatedAt = new Date().toISOString();
    const { archivedAt: _archivedAt, ...activeChat } = chat;
    return this.repository.transaction(async (repository) => {
      const updated = await repository.updateChat({
        ...activeChat,
        updatedAt,
      });
      await this.audit(
        input.subject,
        "chat.unarchive",
        updated.id,
        {
          workspaceId: updated.workspaceId,
          unarchivedAt: updatedAt,
        },
        repository,
      );
      return updated;
    });
  }

  async updateLegalHold(input: {
    chatId: string;
    subject: AuthSubject;
    legalHoldUntil?: string | null;
    legalHoldReason?: string;
  }): Promise<Chat> {
    assertScope(input.subject, "admin:write");
    const chat = await this.repository.getChat(input.chatId);
    if (!chat) throw notFound("Chat");
    if (!canAccessOrg(input.subject, chat.orgId)) {
      throw new AuthorizationError(
        "The chat is outside the caller organization.",
      );
    }
    if (!hasWorkspaceAccess(input.subject, chat.workspaceId)) {
      throw new AuthorizationError(
        "The workspace is outside the caller access.",
      );
    }

    const now = new Date();
    const updatedAt = now.toISOString();
    if (input.legalHoldUntil === undefined || input.legalHoldUntil === null) {
      return this.repository.transaction(async (repository) => {
        const updated = await repository.updateChat(
          withoutLegalHold({ ...chat, updatedAt }),
        );
        await this.audit(
          input.subject,
          "chat.legal_hold.clear",
          updated.id,
          {
            workspaceId: updated.workspaceId,
            clearedAt: updatedAt,
          },
          repository,
        );
        return updated;
      });
    }

    const holdUntil = new Date(input.legalHoldUntil);
    if (!Number.isFinite(holdUntil.getTime()) || holdUntil <= now) {
      throw new ApiError(
        "invalid_legal_hold",
        "legalHoldUntil must be a future ISO timestamp.",
        400,
      );
    }

    const reason = input.legalHoldReason?.trim();
    return this.repository.transaction(async (repository) => {
      const updated = await repository.updateChat({
        ...withoutLegalHold(chat),
        legalHoldUntil: holdUntil.toISOString(),
        ...(reason !== undefined && reason.length > 0
          ? { legalHoldReason: reason }
          : {}),
        updatedAt,
      });
      await this.audit(
        input.subject,
        "chat.legal_hold.update",
        updated.id,
        {
          workspaceId: updated.workspaceId,
          legalHoldUntil: updated.legalHoldUntil,
          hasReason: updated.legalHoldReason !== undefined,
        },
        repository,
      );
      return updated;
    });
  }

  private async createOwnerGrants(
    subject: AuthSubject,
    chatId: string,
    repository: RomeoRepository = this.repository,
  ): Promise<void> {
    const permissions: ResourceGrant["permission"][] = ["read", "write"];
    await Promise.all(
      permissions.map((permission) =>
        repository.createResourceGrant({
          id: createId("grant"),
          resourceType: "chat",
          resourceId: chatId,
          principalType: subject.type,
          principalId: subject.id,
          permission,
        }),
      ),
    );
  }

  private async audit(
    subject: AuthSubject,
    action: string,
    resourceId: string,
    metadata: Record<string, unknown>,
    repository: RomeoRepository = this.repository,
  ): Promise<void> {
    await writeAuditLog(repository, {
      subject,
      action,
      resourceType: "chat",
      resourceId,
      metadata,
    });
  }

  private async getFeedbackMessageContext(input: {
    chatId: string;
    messageId: string;
    subject: AuthSubject;
  }): Promise<{ chat: Chat; message: Message }> {
    const chat = await getAuthorizedChat(this.repository, {
      chatId: input.chatId,
      subject: input.subject,
      scope: "chats:read",
      permission: "read",
    });
    const message = await this.repository.getMessage(input.messageId);
    if (!message || message.chatId !== chat.id) throw notFound("Message");
    return { chat, message };
  }

  private async latestMessageFeedbackEvent(
    orgId: string,
    messageId: string,
    actorId: string,
  ): Promise<UsageEvent | undefined> {
    return (await this.messageFeedbackEventsByMessageId(orgId, actorId)).get(
      messageId,
    );
  }

  private async messageFeedbackEventsByMessageId(
    orgId: string,
    actorId: string,
  ): Promise<Map<string, UsageEvent>> {
    const eventsByMessageId = new Map<string, UsageEvent>();
    for (const event of await this.repository.listUsageEvents(orgId)) {
      if (
        event.actorId !== actorId ||
        event.sourceType !== "chat" ||
        event.metric !== messageFeedbackMetric ||
        eventsByMessageId.has(event.sourceId)
      ) {
        continue;
      }
      eventsByMessageId.set(event.sourceId, event);
    }
    return eventsByMessageId;
  }
}

const messageFeedbackMetric = "chat.message.feedback";

const messageFeedbackRedaction: MessageFeedbackState["redaction"] = {
  freeTextReturned: false,
  messageContentReturned: false,
  rawUsageMetadataReturned: false,
  reviewerIdentityReturned: false,
};

function normalizedForkTitle(title: string | undefined, sourceTitle: string) {
  const normalized = title?.trim();
  if (normalized !== undefined && normalized.length > 0) return normalized;
  const fallback = `Fork of ${sourceTitle.trim() || "Untitled chat"}`;
  return fallback.length <= 200 ? fallback : fallback.slice(0, 200);
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

function selectedMessageIndex(messages: Message[], messageId: string): number {
  const index = messages.findIndex((message) => message.id === messageId);
  if (index < 0) throw notFound("Message");
  return index;
}

function publicMessageFeedback(
  chatId: string,
  messageId: string,
  event: UsageEvent | undefined,
): MessageFeedbackState {
  const base = {
    chatId,
    messageId,
    redaction: { ...messageFeedbackRedaction },
  };
  if (event === undefined) return { ...base, configured: false };
  const rating = messageFeedbackRating(event.metadata.rating);
  if (rating === undefined || event.metadata.configured === false) {
    return {
      ...base,
      configured: false,
      createdAt: event.createdAt,
      updatedAt: metadataString(event.metadata.updatedAt) ?? event.createdAt,
    };
  }
  const reasonCode = metadataString(event.metadata.reasonCode);
  return {
    ...base,
    configured: true,
    rating,
    ...(reasonCode === undefined ? {} : { reasonCode }),
    createdAt: event.createdAt,
    updatedAt: metadataString(event.metadata.updatedAt) ?? event.createdAt,
  };
}

function messageFeedbackMetadata(input: {
  chatId: string;
  configured: boolean;
  messageId: string;
  rating: "negative" | "none" | "positive";
  reasonCode?: string;
  updatedAt: string;
  workspaceId: string;
}): Record<string, unknown> {
  return {
    schema: "romeo.chat-message-feedback.v1",
    chatId: input.chatId,
    workspaceId: input.workspaceId,
    messageId: input.messageId,
    configured: input.configured,
    rating: input.rating,
    ...(input.reasonCode !== undefined ? { reasonCode: input.reasonCode } : {}),
    updatedAt: input.updatedAt,
    redaction: { ...messageFeedbackRedaction },
  };
}

function messageFeedbackRating(
  value: unknown,
): "negative" | "positive" | undefined {
  if (value === "negative" || value === "positive") return value;
  return undefined;
}

function metadataString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function withoutLegalHold(chat: Chat): Chat {
  const {
    legalHoldUntil: _legalHoldUntil,
    legalHoldReason: _legalHoldReason,
    ...rest
  } = chat;
  return rest;
}

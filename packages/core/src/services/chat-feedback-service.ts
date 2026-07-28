import type { AuthSubject } from "@romeo/auth";

import type {
  Chat,
  Message,
  MessageFeedbackState,
  UsageEvent,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { writeAuditLog } from "./audit-log";
import { getAuthorizedChat } from "./chat-access";
import { persistedSubjectActorId } from "./subject-persisted-actor";

const messageFeedbackMetric = "chat.message.feedback";
const messageFeedbackRedaction: MessageFeedbackState["redaction"] = {
  freeTextReturned: false,
  messageContentReturned: false,
  rawUsageMetadataReturned: false,
  reviewerIdentityReturned: false,
};

export class ChatFeedbackService {
  constructor(private readonly repository: RomeoRepository) {}

  async get(input: {
    chatId: string;
    messageId: string;
    subject: AuthSubject;
  }): Promise<MessageFeedbackState> {
    const { chat, message } = await this.getMessageContext(input);
    const actorId = await this.feedbackActorId(input.subject);
    return publicMessageFeedback(
      chat.id,
      message.id,
      await this.latestEvent(chat.orgId, message.id, actorId),
    );
  }

  async list(
    chatId: string,
    subject: AuthSubject,
  ): Promise<MessageFeedbackState[]> {
    const chat = await getAuthorizedChat(this.repository, {
      chatId,
      subject,
      scope: "chats:read",
      permission: "read",
    });
    const events = await this.eventsByMessageId(
      chat.orgId,
      await this.feedbackActorId(subject),
    );
    return (await this.repository.listMessages(chat.id))
      .filter((message) => message.role === "assistant")
      .map((message) =>
        publicMessageFeedback(chat.id, message.id, events.get(message.id)),
      );
  }

  async update(input: {
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
    const { chat, message } = await this.getMessageContext(input);
    if (message.role !== "assistant") {
      throw new ApiError(
        "message_feedback_unsupported_role",
        "Only assistant messages can be rated.",
        409,
      );
    }

    const actorId = await this.feedbackActorId(input.subject);
    const existing = await this.latestEvent(chat.orgId, message.id, actorId);
    const now = new Date().toISOString();
    const metadata = messageFeedbackMetadata({
      chatId: chat.id,
      configured: input.rating !== "none",
      messageId: message.id,
      rating: input.rating,
      ...(input.reasonCode === undefined
        ? {}
        : { reasonCode: input.reasonCode }),
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
    await writeAuditLog(this.repository, {
      subject: input.subject,
      action:
        input.rating === "none"
          ? "chat.message_feedback.clear"
          : "chat.message_feedback.record",
      resourceType: "chat",
      resourceId: chat.id,
      metadata: {
        workspaceId: chat.workspaceId,
        messageId: message.id,
        messageRole: message.role,
        configured: input.rating !== "none",
        rating: input.rating,
        reasonCodeConfigured: input.reasonCode !== undefined,
      },
    });
    return publicMessageFeedback(chat.id, message.id, event);
  }

  private async feedbackActorId(subject: AuthSubject): Promise<string> {
    return persistedSubjectActorId(this.repository, subject, {
      kind: "service_account_usage",
      name: "Service Account Usage Actor",
    });
  }

  private async getMessageContext(input: {
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

  private async latestEvent(
    orgId: string,
    messageId: string,
    actorId: string,
  ): Promise<UsageEvent | undefined> {
    return (await this.eventsByMessageId(orgId, actorId)).get(messageId);
  }

  private async eventsByMessageId(
    orgId: string,
    actorId: string,
  ): Promise<Map<string, UsageEvent>> {
    const events = new Map<string, UsageEvent>();
    for (const event of await this.repository.listUsageEvents(orgId)) {
      if (
        event.actorId === actorId &&
        event.sourceType === "chat" &&
        event.metric === messageFeedbackMetric &&
        !events.has(event.sourceId)
      ) {
        events.set(event.sourceId, event);
      }
    }
    return events;
  }
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
    ...(input.reasonCode === undefined ? {} : { reasonCode: input.reasonCode }),
    updatedAt: input.updatedAt,
    redaction: { ...messageFeedbackRedaction },
  };
}

function messageFeedbackRating(
  value: unknown,
): "negative" | "positive" | undefined {
  return value === "negative" || value === "positive" ? value : undefined;
}

function metadataString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

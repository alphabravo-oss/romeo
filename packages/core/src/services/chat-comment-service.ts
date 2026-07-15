import type { ResourceGrant } from "@romeo/auth";
import type { AuthSubject } from "@romeo/auth";

import type { Chat, ChatComment } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { createId } from "../ids";
import { getAuthorizedChat } from "./chat-access";
import {
  disabledNotificationDeliverySender,
  type NotificationDeliverySender,
} from "./notification-delivery";
import { deliveryChannelsForNotification } from "./notification-service";

export class ChatCommentService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly notificationDelivery: NotificationDeliverySender = disabledNotificationDeliverySender,
  ) {}

  async list(subject: AuthSubject, chatId: string): Promise<ChatComment[]> {
    const chat = await getAuthorizedChat(this.repository, {
      chatId,
      subject,
      scope: "chats:read",
      permission: "read",
    });
    return this.repository.listChatComments(chat.id);
  }

  async create(input: {
    subject: AuthSubject;
    chatId: string;
    body: string;
  }): Promise<ChatComment> {
    const chat = await getAuthorizedChat(this.repository, {
      chatId: input.chatId,
      subject: input.subject,
      scope: "chats:write",
      permission: "write",
    });
    const mentionedUserIds = await this.resolveMentionedUserIds(
      chat,
      input.body,
    );
    return this.repository.transaction(async (repository) => {
      const comment = await repository.createChatComment({
        id: createId("chat_comment"),
        orgId: chat.orgId,
        chatId: chat.id,
        authorId: input.subject.id,
        body: input.body,
        mentionedUserIds,
        createdAt: new Date().toISOString(),
      });
      await this.createMentionNotifications(
        repository,
        input.subject,
        chat.id,
        comment.id,
        mentionedUserIds,
      );
      await this.audit(repository, input.subject, chat.id, mentionedUserIds);
      return comment;
    });
  }

  private async resolveMentionedUserIds(
    chat: Chat,
    body: string,
  ): Promise<string[]> {
    const candidateIds = extractMentionIds(body);
    if (candidateIds.length === 0) return [];

    const grants = await this.repository.listResourceGrants(chat.orgId);
    const resolved: string[] = [];
    for (const userId of candidateIds) {
      const user = await this.repository.getCurrentUser(userId);
      if (user?.orgId !== chat.orgId) continue;
      if (
        user.id === chat.createdBy ||
        hasDirectChatReadGrant(grants, chat.id, user.id)
      )
        resolved.push(user.id);
    }
    return resolved;
  }

  private async audit(
    repository: RomeoRepository,
    subject: AuthSubject,
    chatId: string,
    mentionedUserIds: string[],
  ): Promise<void> {
    await repository.createAuditLog({
      id: createId("audit"),
      orgId: subject.orgId,
      actorId: subject.id,
      action: "chat.comment",
      resourceType: "chat",
      resourceId: chatId,
      outcome: "success",
      metadata: { mentionedUserIds },
      createdAt: new Date().toISOString(),
    });
  }

  private async createMentionNotifications(
    repository: RomeoRepository,
    subject: AuthSubject,
    chatId: string,
    commentId: string,
    mentionedUserIds: string[],
  ): Promise<void> {
    await Promise.all(
      mentionedUserIds.map(async (userId) => {
        const notification = await repository.createUserNotification({
          id: createId("notification"),
          orgId: subject.orgId,
          userId,
          type: "chat_mention",
          actorId: subject.id,
          resourceType: "chat",
          resourceId: chatId,
          metadata: { chatId, commentId },
          createdAt: new Date().toISOString(),
        });
        const channels = await deliveryChannelsForNotification({
          repository,
          orgId: subject.orgId,
          userId,
          notification,
        });
        await Promise.all(
          channels.map((channel) =>
            this.notificationDelivery.createDelivery({
              repository,
              notification,
              channel,
            }),
          ),
        );
      }),
    );
  }
}

function extractMentionIds(body: string): string[] {
  const matches = body.matchAll(/@([A-Za-z0-9_:-]{1,128})/g);
  return [
    ...new Set(
      [...matches]
        .map((match) => match[1]!)
        .filter((value) => value.length > 0),
    ),
  ];
}

function hasDirectChatReadGrant(
  grants: ResourceGrant[],
  chatId: string,
  userId: string,
): boolean {
  return grants.some(
    (grant) =>
      grant.resourceType === "chat" &&
      grant.resourceId === chatId &&
      grant.principalType === "user" &&
      grant.principalId === userId &&
      (grant.permission === "read" || grant.permission === "write"),
  );
}

import { createHash } from "node:crypto";

import { AuthorizationError, assertScope, type AuthSubject } from "@romeo/auth";

import type { Chat, ChatTag } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { createId } from "../ids";
import { canReadChat, getAuthorizedChat } from "./chat-access";
import { writeAuditLog } from "./audit-log";

export class ChatTagService {
  constructor(private readonly repository: RomeoRepository) {}

  async list(subject: AuthSubject): Promise<ChatTag[]> {
    assertScope(subject, "chats:read");
    assertUserSubject(subject);
    return this.repository.listChatTags(subject.orgId, subject.id);
  }

  async chatsForTag(
    subject: AuthSubject,
    tagSlug: string,
    options: { archived?: "active" | "all" | "archived" } = {},
  ): Promise<Chat[]> {
    assertScope(subject, "chats:read");
    assertUserSubject(subject);
    const slug = normalizeChatTagSlug(tagSlug);
    if (slug.length === 0) return [];
    const [chatIds, grants] = await Promise.all([
      this.repository.listChatIdsByTag(subject.orgId, subject.id, slug),
      this.repository.listResourceGrants(subject.orgId),
    ]);
    const chats = await Promise.all(
      chatIds.map((chatId) => this.repository.getChat(chatId)),
    );
    const archived = options.archived ?? "active";
    return chats
      .filter((chat): chat is Chat => chat !== undefined)
      .filter((chat) => {
        if (archived === "all") return true;
        if (archived === "archived") return chat.archivedAt !== undefined;
        return chat.archivedAt === undefined;
      })
      .filter((chat) => canReadChat(subject, grants, chat))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async forChat(input: {
    chatId: string;
    subject: AuthSubject;
  }): Promise<ChatTag[]> {
    assertScope(input.subject, "chats:read");
    assertUserSubject(input.subject);
    await getAuthorizedChat(this.repository, {
      chatId: input.chatId,
      subject: input.subject,
      scope: "chats:read",
      permission: "read",
    });
    return this.repository.listChatTagsForChat(
      input.subject.orgId,
      input.subject.id,
      input.chatId,
    );
  }

  async assign(input: {
    chatId: string;
    name: string;
    subject: AuthSubject;
  }): Promise<ChatTag[]> {
    assertScope(input.subject, "chats:write");
    assertUserSubject(input.subject);
    const name = normalizeChatTagName(input.name);
    const slug = normalizeChatTagSlug(name);
    if (slug.length === 0) {
      throw new ApiError(
        "invalid_chat_tag",
        "A non-empty chat tag name is required.",
        400,
      );
    }
    const chat = await getAuthorizedChat(this.repository, {
      chatId: input.chatId,
      subject: input.subject,
      scope: "chats:write",
      permission: "read",
    });
    await this.repository.transaction(async (repository) => {
      const now = new Date().toISOString();
      const tag = await repository.upsertChatTag({
        id: createId("chat_tag"),
        orgId: input.subject.orgId,
        userId: input.subject.id,
        slug,
        name,
        createdAt: now,
        updatedAt: now,
      });
      await repository.createChatTagAssignment({
        id: createId("chat_tag_assignment"),
        orgId: input.subject.orgId,
        userId: input.subject.id,
        chatId: chat.id,
        tagId: tag.id,
        createdAt: now,
      });
      await writeAuditLog(repository, {
        subject: input.subject,
        action: "chat.tag.assign",
        resourceType: "chat",
        resourceId: chat.id,
        metadata: tagAuditMetadata(chat.workspaceId, tag),
      });
    });
    return this.forChat({ subject: input.subject, chatId: chat.id });
  }

  async remove(input: {
    chatId: string;
    subject: AuthSubject;
    tagSlug: string;
  }): Promise<ChatTag[]> {
    assertScope(input.subject, "chats:write");
    assertUserSubject(input.subject);
    const slug = normalizeChatTagSlug(input.tagSlug);
    const chat = await getAuthorizedChat(this.repository, {
      chatId: input.chatId,
      subject: input.subject,
      scope: "chats:write",
      permission: "read",
    });
    if (slug.length === 0) {
      return this.forChat({ subject: input.subject, chatId: chat.id });
    }
    await this.repository.transaction(async (repository) => {
      await repository.deleteChatTagAssignment(
        input.subject.orgId,
        input.subject.id,
        chat.id,
        slug,
      );
      const orphanDeleted =
        (await repository.countChatTagAssignments(
          input.subject.orgId,
          input.subject.id,
          slug,
        )) === 0;
      const deletedTag = orphanDeleted
        ? await repository.deleteChatTag(
            input.subject.orgId,
            input.subject.id,
            slug,
          )
        : undefined;
      await writeAuditLog(repository, {
        subject: input.subject,
        action: "chat.tag.remove",
        resourceType: "chat",
        resourceId: chat.id,
        metadata: {
          workspaceId: chat.workspaceId,
          tagSlugHash: stableHash(slug),
          orphanDeleted,
          tagNameReturned: false,
          ...(deletedTag === undefined ? {} : { tagId: deletedTag.id }),
        },
      });
    });
    return this.forChat({ subject: input.subject, chatId: chat.id });
  }
}

function assertUserSubject(
  subject: AuthSubject,
): asserts subject is AuthSubject & {
  type: "user";
} {
  if (subject.type !== "user") {
    throw new AuthorizationError(
      "Chat tags are available only for user subjects.",
    );
  }
}

function normalizeChatTagName(name: string): string {
  return name.trim().replace(/\s+/gu, " ");
}

function normalizeChatTagSlug(name: string): string {
  return name.trim().replace(/\s+/gu, "_").toLowerCase();
}

function tagAuditMetadata(workspaceId: string, tag: ChatTag) {
  return {
    workspaceId,
    tagId: tag.id,
    tagSlugHash: stableHash(tag.slug),
    tagNameReturned: false,
  };
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

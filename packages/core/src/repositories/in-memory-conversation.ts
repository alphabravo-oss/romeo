import type * as E from "../domain/entities";
import type * as R from "../domain/repository";
import {
  append,
  appendMany,
  removeById,
  replaceById,
} from "./collection-helpers";
import { InMemoryChatRepository } from "./in-memory-chat";

export abstract class InMemoryConversationRepository extends InMemoryChatRepository {
  async listMessages(chatId: string): Promise<E.Message[]> {
    return this.data.messages
      .filter((message) => message.chatId === chatId)
      .sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          left.id.localeCompare(right.id),
      );
  }

  async searchChatContent(
    workspaceId: string,
    query: string,
  ): Promise<Array<{ chatId: string; messageId?: string; snippet: string }>> {
    const needle = query.toLowerCase();
    const results: Array<{
      chatId: string;
      messageId?: string;
      snippet: string;
    }> = [];
    for (const chat of this.data.chats.filter(
      (item) => item.workspaceId === workspaceId,
    )) {
      if (chat.title.toLowerCase().includes(needle)) {
        results.push({ chatId: chat.id, snippet: chat.title });
        continue;
      }
      const message = this.data.messages.find(
        (item) =>
          item.chatId === chat.id &&
          item.content.toLowerCase().includes(needle),
      );
      if (message !== undefined) {
        const index = message.content.toLowerCase().indexOf(needle);
        results.push({
          chatId: chat.id,
          messageId: message.id,
          snippet: message.content.slice(
            Math.max(0, index - 60),
            index + needle.length + 100,
          ),
        });
        continue;
      }
      const attachment = this.data.messageParts.find((part) => {
        const parent = this.data.messages.find(
          (item) => item.id === part.messageId && item.chatId === chat.id,
        );
        return (
          parent !== undefined &&
          typeof part.metadata.fileName === "string" &&
          part.metadata.fileName.toLowerCase().includes(needle)
        );
      });
      if (attachment !== undefined)
        results.push({
          chatId: chat.id,
          messageId: attachment.messageId,
          snippet: String(attachment.metadata.fileName),
        });
    }
    return results;
  }

  async getMessage(messageId: string): Promise<E.Message | undefined> {
    return this.data.messages.find((message) => message.id === messageId);
  }

  async createMessage(message: E.Message): Promise<E.Message> {
    return append(this.data.messages, message);
  }

  async deleteMessage(messageId: string): Promise<void> {
    const message = this.data.messages.find((item) => item.id === messageId);
    if (message === undefined) return;
    // Splice, don't sever: children adopt their grandparent. Left dangling, every turn above the
    // deleted row falls off the branch and silently stops being replayed to the provider.
    this.data.messages = this.data.messages
      .filter((item) => item.id !== messageId)
      .map((item) => {
        if (item.parentId !== messageId) return item;
        const child = { ...item };
        if (message.parentId === undefined) delete child.parentId;
        else child.parentId = message.parentId;
        return child;
      });
    this.data.messageParts = this.data.messageParts.filter(
      (part) => part.messageId !== messageId,
    );
    const chat = this.data.chats.find((item) => item.id === message.chatId);
    if (chat === undefined || chat.activeLeafMessageId !== messageId) return;
    // A pointer still naming the deleted row resolves to no branch, so the next turn would persist
    // as a fresh root and collapse the transcript. Its parent is the tip of what is left; a deleted
    // root has none, so fall back to the newest surviving row — a child is always written after its
    // parent, which makes the newest row a branch tip.
    const replacement =
      message.parentId ?? (await this.listMessages(message.chatId)).at(-1)?.id;
    const repaired = { ...chat };
    if (replacement === undefined) delete repaired.activeLeafMessageId;
    else repaired.activeLeafMessageId = replacement;
    await this.updateChat(repaired);
  }

  async listMessageParts(messageId: string): Promise<E.MessagePart[]> {
    return this.data.messageParts.filter(
      (part) => part.messageId === messageId,
    );
  }

  async getMessagePart(
    messagePartId: string,
  ): Promise<E.MessagePart | undefined> {
    return this.data.messageParts.find((part) => part.id === messagePartId);
  }

  async createMessageParts(parts: E.MessagePart[]): Promise<E.MessagePart[]> {
    return appendMany(this.data.messageParts, parts);
  }

  async updateMessagePart(part: E.MessagePart): Promise<E.MessagePart> {
    const index = this.data.messageParts.findIndex(
      (item) => item.id === part.id,
    );
    if (index >= 0) this.data.messageParts[index] = part;
    else this.data.messageParts.push(part);
    return part;
  }

  async listFileObjects(
    orgId: string,
    workspaceId?: string,
  ): Promise<E.FileObject[]> {
    return this.data.fileObjects
      .filter((file) => file.orgId === orgId)
      .filter(
        (file) => workspaceId === undefined || file.workspaceId === workspaceId,
      )
      .sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) ||
          left.id.localeCompare(right.id),
      );
  }

  async listAuthorizedFileObjectsPage(
    input: R.AuthorizedFileCatalogQuery,
  ): Promise<{ items: E.FileObject[]; total: number }> {
    const query = input.query?.trim().toLocaleLowerCase() ?? "";
    const visible = this.data.fileObjects
      .filter(
        (file) =>
          file.orgId === input.orgId &&
          file.workspaceId === input.workspaceId &&
          file.status === "available",
      )
      .filter(
        (file) =>
          input.purposes === undefined || input.purposes.includes(file.purpose),
      )
      .filter(
        (file) =>
          input.excludePurposes === undefined ||
          !input.excludePurposes.includes(file.purpose),
      )
      .filter((file) => {
        if (query === "") return true;
        const title =
          typeof file.metadata.title === "string" ? file.metadata.title : "";
        return `${file.fileName} ${file.mimeType} ${title}`
          .toLocaleLowerCase()
          .includes(query);
      })
      .filter((file) => {
        if (input.isAdmin) return true;
        if (
          file.ownerType === input.principalType &&
          file.ownerId === input.principalId
        )
          return true;
        if (
          input.accessMode === "workspace_content" &&
          file.metadata.scope === "workspace"
        )
          return true;
        return (
          input.accessMode === "file_grants" &&
          this.data.grants.some(
            (grant) =>
              grant.resourceType === "file" &&
              grant.resourceId === file.id &&
              (grant.permission === "read" || grant.permission === "write") &&
              ((grant.principalType === input.principalType &&
                grant.principalId === input.principalId) ||
                (grant.principalType === "group" &&
                  input.groupIds.includes(grant.principalId))),
          )
        );
      })
      .sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) ||
          left.id.localeCompare(right.id),
      );
    return {
      items: visible.slice(input.offset, input.offset + input.limit),
      total: visible.length,
    };
  }

  async getFileObject(fileId: string): Promise<E.FileObject | undefined> {
    return this.data.fileObjects.find((file) => file.id === fileId);
  }

  async createFileObject(file: E.FileObject): Promise<E.FileObject> {
    return append(this.data.fileObjects, file);
  }

  async updateFileObject(file: E.FileObject): Promise<E.FileObject> {
    return replaceById(this.data.fileObjects, file);
  }

  async listChatComments(chatId: string): Promise<E.ChatComment[]> {
    return this.data.chatComments
      .filter((comment) => comment.chatId === chatId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async createChatComment(comment: E.ChatComment): Promise<E.ChatComment> {
    return append(this.data.chatComments, comment);
  }

  async listChatTags(orgId: string, userId: string): Promise<E.ChatTag[]> {
    return this.data.chatTags
      .filter((tag) => tag.orgId === orgId && tag.userId === userId)
      .sort(
        (left, right) =>
          left.name.localeCompare(right.name) ||
          left.slug.localeCompare(right.slug),
      );
  }

  async listChatTagsForChat(
    orgId: string,
    userId: string,
    chatId: string,
  ): Promise<E.ChatTag[]> {
    const tagIds = new Set(
      this.data.chatTagAssignments
        .filter(
          (assignment) =>
            assignment.orgId === orgId &&
            assignment.userId === userId &&
            assignment.chatId === chatId,
        )
        .map((assignment) => assignment.tagId),
    );
    return this.data.chatTags
      .filter((tag) => tag.orgId === orgId && tagIds.has(tag.id))
      .sort(
        (left, right) =>
          left.name.localeCompare(right.name) ||
          left.slug.localeCompare(right.slug),
      );
  }

  async listChatIdsByTag(
    orgId: string,
    userId: string,
    slug: string,
  ): Promise<string[]> {
    const tag = this.data.chatTags.find(
      (item) =>
        item.orgId === orgId && item.userId === userId && item.slug === slug,
    );
    if (tag === undefined) return [];
    return this.data.chatTagAssignments
      .filter(
        (assignment) =>
          assignment.orgId === orgId &&
          assignment.userId === userId &&
          assignment.tagId === tag.id,
      )
      .map((assignment) => assignment.chatId)
      .sort();
  }

  async upsertChatTag(tag: E.ChatTag): Promise<E.ChatTag> {
    const index = this.data.chatTags.findIndex(
      (item) =>
        item.orgId === tag.orgId &&
        item.userId === tag.userId &&
        item.slug === tag.slug,
    );
    if (index < 0) return append(this.data.chatTags, tag);
    const existing = this.data.chatTags[index]!;
    const updated = {
      ...existing,
      name: tag.name,
      updatedAt: tag.updatedAt,
      ...(tag.meta === undefined ? {} : { meta: tag.meta }),
    };
    this.data.chatTags[index] = updated;
    return updated;
  }

  async createChatTagAssignment(
    assignment: E.ChatTagAssignment,
  ): Promise<E.ChatTagAssignment> {
    const existing = this.data.chatTagAssignments.find(
      (item) =>
        item.orgId === assignment.orgId &&
        item.userId === assignment.userId &&
        item.chatId === assignment.chatId &&
        item.tagId === assignment.tagId,
    );
    return existing ?? append(this.data.chatTagAssignments, assignment);
  }

  async deleteChatTagAssignment(
    orgId: string,
    userId: string,
    chatId: string,
    slug: string,
  ): Promise<E.ChatTagAssignment | undefined> {
    const tag = this.data.chatTags.find(
      (item) =>
        item.orgId === orgId && item.userId === userId && item.slug === slug,
    );
    if (tag === undefined) return undefined;
    const index = this.data.chatTagAssignments.findIndex(
      (assignment) =>
        assignment.orgId === orgId &&
        assignment.userId === userId &&
        assignment.chatId === chatId &&
        assignment.tagId === tag.id,
    );
    if (index < 0) return undefined;
    return this.data.chatTagAssignments.splice(index, 1)[0];
  }

  async countChatTagAssignments(
    orgId: string,
    userId: string,
    slug: string,
  ): Promise<number> {
    const tag = this.data.chatTags.find(
      (item) =>
        item.orgId === orgId && item.userId === userId && item.slug === slug,
    );
    if (tag === undefined) return 0;
    return this.data.chatTagAssignments.filter(
      (assignment) =>
        assignment.orgId === orgId &&
        assignment.userId === userId &&
        assignment.tagId === tag.id,
    ).length;
  }

  async deleteChatTag(
    orgId: string,
    userId: string,
    slug: string,
  ): Promise<E.ChatTag | undefined> {
    const index = this.data.chatTags.findIndex(
      (tag) =>
        tag.orgId === orgId && tag.userId === userId && tag.slug === slug,
    );
    if (index < 0) return undefined;
    const [deleted] = this.data.chatTags.splice(index, 1);
    if (deleted !== undefined) {
      this.data.chatTagAssignments = this.data.chatTagAssignments.filter(
        (assignment) => assignment.tagId !== deleted.id,
      );
    }
    return deleted;
  }

  async listCollaborationChannels(
    orgId: string,
  ): Promise<E.CollaborationChannel[]> {
    return this.data.collaborationChannels
      .filter((channel) => channel.orgId === orgId)
      .sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) ||
          left.id.localeCompare(right.id),
      );
  }

  async getCollaborationChannel(
    channelId: string,
  ): Promise<E.CollaborationChannel | undefined> {
    return this.data.collaborationChannels.find(
      (channel) => channel.id === channelId,
    );
  }

  async createCollaborationChannel(
    channel: E.CollaborationChannel,
  ): Promise<E.CollaborationChannel> {
    return append(this.data.collaborationChannels, channel);
  }

  async updateCollaborationChannel(
    channel: E.CollaborationChannel,
  ): Promise<E.CollaborationChannel> {
    return replaceById(this.data.collaborationChannels, channel);
  }

  async deleteCollaborationChannel(
    channelId: string,
  ): Promise<E.CollaborationChannel | undefined> {
    const deleted = removeById(this.data.collaborationChannels, channelId);
    if (deleted !== undefined) {
      this.data.collaborationChannelMembers =
        this.data.collaborationChannelMembers.filter(
          (member) => member.channelId !== channelId,
        );
    }
    return deleted;
  }

  async listCollaborationChannelMembers(
    orgId: string,
    channelId?: string,
    userId?: string,
  ): Promise<E.CollaborationChannelMember[]> {
    return this.data.collaborationChannelMembers
      .filter(
        (member) =>
          member.orgId === orgId &&
          (channelId === undefined || member.channelId === channelId) &&
          (userId === undefined || member.userId === userId),
      )
      .sort(
        (left, right) =>
          left.channelId.localeCompare(right.channelId) ||
          left.userId.localeCompare(right.userId),
      );
  }

  async getCollaborationChannelMember(
    channelId: string,
    userId: string,
  ): Promise<E.CollaborationChannelMember | undefined> {
    return this.data.collaborationChannelMembers.find(
      (member) => member.channelId === channelId && member.userId === userId,
    );
  }

  async createCollaborationChannelMember(
    member: E.CollaborationChannelMember,
  ): Promise<E.CollaborationChannelMember> {
    const existing = await this.getCollaborationChannelMember(
      member.channelId,
      member.userId,
    );
    return existing ?? append(this.data.collaborationChannelMembers, member);
  }

  async updateCollaborationChannelMember(
    member: E.CollaborationChannelMember,
  ): Promise<E.CollaborationChannelMember> {
    return replaceById(this.data.collaborationChannelMembers, member);
  }

  async deleteCollaborationChannelMembers(
    channelId: string,
    userIds: string[],
  ): Promise<E.CollaborationChannelMember[]> {
    const userIdSet = new Set(userIds);
    const deleted = this.data.collaborationChannelMembers.filter(
      (member) =>
        member.channelId === channelId && userIdSet.has(member.userId),
    );
    this.data.collaborationChannelMembers =
      this.data.collaborationChannelMembers.filter(
        (member) =>
          member.channelId !== channelId || !userIdSet.has(member.userId),
      );
    return deleted;
  }
}

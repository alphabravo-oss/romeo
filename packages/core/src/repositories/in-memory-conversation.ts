import type * as E from "../domain/entities";
import type * as R from "../domain/repository";
import { ApiError } from "../errors";
import type {
  ClaimFileLifecycleInput,
  FinishFileLifecycleLeaseInput,
  RenewFileLifecycleLeaseInput,
} from "../domain/repository-content";
import { append, removeById, replaceById } from "./collection-helpers";
import { InMemoryChatRepository } from "./in-memory-chat";
import {
  searchInMemoryAuthorizedChatMessages,
  searchInMemoryChatContent,
} from "./in-memory-chat-search";
import { queryInMemoryMessagePage } from "./in-memory-message-page";
import {
  backfillInMemoryMessageTextParts,
  createMessageWithTextPart,
  findOrderedMessagePart,
  listOrderedMessagePartsForMessages,
  orderedMessageParts,
} from "./in-memory-message-parts";
import {
  claimNextInMemoryFileLifecycle,
  renewInMemoryFileLifecycleLease,
  writeClaimedInMemoryFileLifecycle,
} from "./in-memory-file-lifecycle";
import {
  createInMemoryFile,
  listAuthorizedInMemoryFilesPage,
  listInMemoryFiles,
  updateInMemoryFile,
} from "./in-memory-file-catalog";
import {
  countMessageFileReferencesInMemory,
  createMessagePartsWithFileReferences,
  reconcileChatFileReferencesInMemory,
  removeMessageFileReferences,
  updateMessagePartWithImmutableReferences,
} from "./in-memory-message-file-references";

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

  async queryAuthorizedMessagesPage(
    input: R.AuthorizedMessagePageQuery,
  ): Promise<R.MessagePageQueryResult> {
    return queryInMemoryMessagePage(this.data, input);
  }

  async searchChatContent(
    workspaceId: string,
    query: string,
  ): Promise<Array<{ chatId: string; messageId?: string; snippet: string }>> {
    return searchInMemoryChatContent(this.data, workspaceId, query);
  }

  async searchAuthorizedChatMessages(
    input: R.AuthorizedChatMessageSearchQuery,
  ): Promise<R.ChatMessageSearchQueryResult> {
    return searchInMemoryAuthorizedChatMessages(this.data, input);
  }

  async getMessage(messageId: string): Promise<E.Message | undefined> {
    return this.data.messages.find((message) => message.id === messageId);
  }

  async createMessage(message: E.Message): Promise<E.Message> {
    const created = createMessageWithTextPart(this.data, message);
    this.bumpTranscriptVersion(message.chatId);
    return created;
  }

  async backfillLegacyMessageTextParts(
    input: import("../domain/repository-content").MessagePartBackfillBatchInput,
  ): Promise<
    import("../domain/repository-content").MessagePartBackfillBatchResult
  > {
    return backfillInMemoryMessageTextParts(this.data, input);
  }

  async deleteMessage(messageId: string): Promise<void> {
    const message = this.data.messages.find((item) => item.id === messageId);
    if (message === undefined) return;
    const heldChat = this.data.chats.find((item) => item.id === message.chatId);
    if (
      heldChat?.legalHoldUntil !== undefined &&
      heldChat.legalHoldUntil > new Date().toISOString()
    )
      throw new ApiError(
        "chat_delete_legal_hold",
        "Chat is under legal hold and cannot be changed.",
        409,
      );
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
    removeMessageFileReferences(this.data, messageId);
    this.data.messageParts = this.data.messageParts.filter(
      (part) => part.messageId !== messageId,
    );
    this.bumpTranscriptVersion(message.chatId);
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

  private bumpTranscriptVersion(chatId: string): void {
    const chat = this.data.chats.find((item) => item.id === chatId);
    if (chat === undefined) return;
    chat.transcriptVersion = (
      BigInt(chat.transcriptVersion ?? "0") + 1n
    ).toString();
  }

  async listMessageParts(messageId: string): Promise<E.MessagePart[]> {
    return orderedMessageParts(
      this.data.messageParts.filter((part) => part.messageId === messageId),
    );
  }

  async listMessagePartsForMessages(
    messageIds: string[],
  ): Promise<E.MessagePart[]> {
    return listOrderedMessagePartsForMessages(this.data, messageIds);
  }

  async getMessagePart(
    messagePartId: string,
  ): Promise<E.MessagePart | undefined> {
    return findOrderedMessagePart(this.data, messagePartId);
  }

  async createMessageParts(parts: E.MessagePart[]): Promise<E.MessagePart[]> {
    return createMessagePartsWithFileReferences(this.data, parts);
  }

  async updateMessagePart(part: E.MessagePart): Promise<E.MessagePart> {
    return updateMessagePartWithImmutableReferences(this.data, part);
  }

  async reconcileChatFileReferences(chatId: string, now: string): Promise<E.FileObject[]> {
    return reconcileChatFileReferencesInMemory(this.data, chatId, now);
  }

  async countMessageFileReferences(fileId: string): Promise<number> {
    return countMessageFileReferencesInMemory(this.data, fileId);
  }

  async listFileObjects(
    orgId: string,
    workspaceId?: string,
  ): Promise<E.FileObject[]> {
    return listInMemoryFiles(this.data, orgId, workspaceId);
  }

  async listAuthorizedFileObjectsPage(
    input: R.AuthorizedFileCatalogQuery,
  ): Promise<{ items: E.FileObject[]; total: number }> {
    return listAuthorizedInMemoryFilesPage(this.data, input);
  }

  async getFileObject(fileId: string): Promise<E.FileObject | undefined> {
    return this.data.fileObjects.find((file) => file.id === fileId);
  }

  async createFileObject(file: E.FileObject): Promise<E.FileObject> {
    return createInMemoryFile(this.data, file);
  }

  async updateFileObject(file: E.FileObject): Promise<E.FileObject> {
    return updateInMemoryFile(this.data, file);
  }

  async claimNextFileLifecycle(
    input: ClaimFileLifecycleInput,
  ): Promise<E.FileObject | undefined> {
    return claimNextInMemoryFileLifecycle(this.data, input);
  }

  async renewFileLifecycleLease(
    input: RenewFileLifecycleLeaseInput,
  ): Promise<E.FileObject | undefined> {
    return renewInMemoryFileLifecycleLease(this.data, input);
  }

  async finishFileLifecycleLease(
    input: FinishFileLifecycleLeaseInput,
  ): Promise<E.FileObject | undefined> {
    return this.writeClaimedFileLifecycle(input, true);
  }

  async advanceFileLifecycleLease(
    input: FinishFileLifecycleLeaseInput,
  ): Promise<E.FileObject | undefined> {
    return this.writeClaimedFileLifecycle(input, false);
  }

  private writeClaimedFileLifecycle(
    input: FinishFileLifecycleLeaseInput,
    clearLease: boolean,
  ): E.FileObject | undefined {
    return writeClaimedInMemoryFileLifecycle(this.data, input, clearLease);
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

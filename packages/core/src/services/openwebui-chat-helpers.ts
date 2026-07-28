import {
  canAccessOrg,
  hasGrant,
  hasWorkspaceAccess,
  type AuthSubject,
  type ResourceGrant,
} from "@romeo/auth";
import type {
  OpenWebUiFolderListItemResponse,
  OpenWebUiFolderResponse,
  OpenWebUiTagResponse,
} from "@romeo/contracts";

import type {
  Chat,
  ChatTag,
  Message,
  WorkspaceFolder,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { createId } from "../ids";
import { openWebUiTagsFromChat } from "./openwebui-tags";
import {
  arrayRecords,
  asRecord,
  messageRole,
  numericTimestamp,
  textContent,
  timestampToIso,
  toEpochSeconds,
  trimmedString,
} from "./openwebui-compatibility-values";

export async function createImportedMessages(
  repository: RomeoRepository,
  chatId: string,
  messages: Array<Pick<Message, "content" | "createdAt" | "role">>,
  fallbackCreatedAt: string,
): Promise<void> {
  for (const [index, message] of messages.entries()) {
    await repository.createMessage({
      id: createId("message"),
      chatId,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt || offsetIso(fallbackCreatedAt, index),
    });
  }
}

export async function createImportedChatTags(
  repository: RomeoRepository,
  subject: AuthSubject,
  chatId: string,
  chat: Record<string, unknown>,
  fallbackCreatedAt: string,
): Promise<void> {
  if (subject.type !== "user") return;
  for (const tag of openWebUiTagsFromChat(chat)) {
    await upsertChatTagAssignment(repository, subject, chatId, {
      ...tag,
      createdAt: fallbackCreatedAt,
    });
  }
}

export async function upsertChatTagAssignment(
  repository: RomeoRepository,
  subject: AuthSubject,
  chatId: string,
  tag: { name: string; slug: string; createdAt?: string },
): Promise<void> {
  const now = tag.createdAt ?? new Date().toISOString();
  const chatTag = await repository.upsertChatTag({
    id: createId("chat_tag"),
    orgId: subject.orgId,
    userId: subject.id,
    slug: tag.slug,
    name: tag.name,
    createdAt: now,
    updatedAt: now,
  });
  await repository.createChatTagAssignment({
    id: createId("chat_tag_assignment"),
    orgId: subject.orgId,
    userId: subject.id,
    chatId,
    tagId: chatTag.id,
    createdAt: now,
  });
}

export function toTagResponse(tag: ChatTag): OpenWebUiTagResponse {
  return {
    id: tag.slug,
    name: tag.name,
    user_id: tag.userId,
    meta: tag.meta ?? null,
  };
}

export async function maybePinImportedChat(
  repository: RomeoRepository,
  subject: AuthSubject,
  chatId: string,
  chat: Record<string, unknown>,
): Promise<boolean> {
  if (chat.pinned !== true || subject.type !== "user") return false;
  await repository.createResourceFavorite({
    id: createId("favorite"),
    orgId: subject.orgId,
    userId: subject.id,
    resourceType: "chat",
    resourceId: chatId,
    createdAt: new Date().toISOString(),
  });
  return true;
}

export function titleFromOpenWebUiChat(chat: Record<string, unknown>): string {
  const explicitTitle = trimmedString(chat.title);
  if (explicitTitle !== undefined) return explicitTitle.slice(0, 200);
  const firstUserMessage = messagesFromOpenWebUiChat(chat).find(
    (message) => message.role === "user",
  );
  if (firstUserMessage !== undefined) {
    return firstUserMessage.content.replace(/\s+/gu, " ").slice(0, 80);
  }
  return "New Chat";
}

export function messagesFromOpenWebUiChat(
  chat: Record<string, unknown>,
): Array<Pick<Message, "content" | "createdAt" | "role">> {
  const history = asRecord(chat.history);
  const messageMap = asRecord(history?.messages);
  const currentId = trimmedString(history?.currentId);
  const rawMessages =
    messageMap === undefined
      ? arrayRecords(chat.messages)
      : orderedHistoryMessages(messageMap, currentId);
  return rawMessages
    .map(toMessageDraft)
    .filter(
      (message): message is Pick<Message, "content" | "createdAt" | "role"> =>
        message !== undefined,
    )
    .slice(0, 200);
}

export function toOpenWebUiChatDocument(
  chat: Chat,
  messages: Message[],
): Record<string, unknown> {
  const ordered = [...messages].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id),
  );
  const historyMessages: Record<string, unknown> = {};
  for (const [index, message] of ordered.entries()) {
    const previous = ordered[index - 1];
    const next = ordered[index + 1];
    historyMessages[message.id] = {
      id: message.id,
      parentId: previous?.id ?? null,
      childrenIds: next === undefined ? [] : [next.id],
      role: message.role,
      content: message.content,
      timestamp: toEpochSeconds(message.createdAt),
      models: [],
    };
  }
  return {
    id: chat.id,
    title: chat.title,
    history: {
      messages: historyMessages,
      currentId: ordered.at(-1)?.id ?? null,
    },
    messages: ordered.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      timestamp: toEpochSeconds(message.createdAt),
    })),
  };
}

export function toFolderListItem(
  folder: WorkspaceFolder,
): OpenWebUiFolderListItemResponse {
  return {
    id: folder.id,
    name: folder.name,
    meta: folder.meta ?? null,
    parent_id: folder.parentId ?? null,
    is_expanded: folder.isExpanded ?? false,
    created_at: toEpochSeconds(folder.createdAt),
    updated_at: toEpochSeconds(folder.updatedAt),
  };
}

export function toFolderResponse(
  folder: WorkspaceFolder,
  userId: string,
): OpenWebUiFolderResponse {
  return {
    ...toFolderListItem(folder),
    user_id: userId,
    items: null,
    data: folder.data ?? null,
  };
}

export function canAccessFolder(
  subject: AuthSubject,
  grants: ResourceGrant[],
  folder: WorkspaceFolder,
  permission: "read" | "write",
): boolean {
  if (!canAccessOrg(subject, folder.orgId)) return false;
  if (!hasWorkspaceAccess(subject, folder.workspaceId)) return false;
  if (subject.isAdmin === true || folder.createdBy === subject.id) return true;
  if (
    permission === "read" &&
    hasGrant(subject, grants, "folder", folder.id, "read")
  ) {
    return true;
  }
  return hasGrant(subject, grants, "folder", folder.id, "write");
}

function offsetIso(baseIso: string, offsetMs: number): string {
  return new Date(new Date(baseIso).getTime() + offsetMs).toISOString();
}

function orderedHistoryMessages(
  messages: Record<string, unknown>,
  currentId?: string,
): Record<string, unknown>[] {
  const records = Object.values(messages)
    .map(asRecord)
    .filter((item): item is Record<string, unknown> => item !== undefined);
  if (currentId === undefined) return sortOpenWebUiMessages(records);
  const byId = new Map(
    records
      .map((message) => [trimmedString(message.id), message] as const)
      .filter(
        (entry): entry is readonly [string, Record<string, unknown>] =>
          entry[0] !== undefined,
      ),
  );
  const chain: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined = currentId;
  while (cursor !== undefined && !seen.has(cursor)) {
    seen.add(cursor);
    const message = byId.get(cursor);
    if (message === undefined) break;
    chain.push(message);
    cursor = trimmedString(message.parentId);
  }
  return chain.length === 0 ? sortOpenWebUiMessages(records) : chain.reverse();
}

function sortOpenWebUiMessages(
  messages: Record<string, unknown>[],
): Record<string, unknown>[] {
  return [...messages].sort(
    (left, right) =>
      numericTimestamp(left.timestamp) - numericTimestamp(right.timestamp),
  );
}

function toMessageDraft(
  message: Record<string, unknown>,
): Pick<Message, "content" | "createdAt" | "role"> | undefined {
  const role = messageRole(message.role);
  if (role === undefined) return undefined;
  const content = textContent(message.content);
  if (content.trim().length === 0) return undefined;
  return {
    role,
    content: content.slice(0, 20_000),
    createdAt: timestampToIso(message.timestamp),
  };
}

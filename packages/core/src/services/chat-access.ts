import {
  AuthorizationError,
  assertScope,
  canAccessOrg,
  hasGrant,
  hasWorkspaceAccess,
  type AuthSubject,
  type ResourceGrant,
} from "@romeo/auth";

import type { Chat } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { notFound } from "../errors";

export async function getAuthorizedChat(
  repository: RomeoRepository,
  input: {
    chatId: string;
    subject: AuthSubject;
    scope: "chats:read" | "chats:write";
    permission: "read" | "write";
  },
): Promise<Chat> {
  assertScope(input.subject, input.scope);
  const chat = await repository.getChat(input.chatId);
  if (!chat) throw notFound("Chat");

  const grants = await repository.listResourceGrants(input.subject.orgId);
  if (!canAccessChat(input.subject, grants, chat, input.permission)) {
    throw new AuthorizationError(
      `Missing ${input.permission} permission for chat:${chat.id}`,
    );
  }
  return chat;
}

export function canReadChat(
  subject: AuthSubject,
  grants: ResourceGrant[],
  chat: Chat,
): boolean {
  return canAccessChat(subject, grants, chat, "read");
}

export function canWriteChat(
  subject: AuthSubject,
  grants: ResourceGrant[],
  chat: Chat,
): boolean {
  return canAccessChat(subject, grants, chat, "write");
}

function canAccessChat(
  subject: AuthSubject,
  grants: ResourceGrant[],
  chat: Chat,
  permission: "read" | "write",
): boolean {
  if (!canAccessOrg(subject, chat.orgId)) return false;
  if (!hasWorkspaceAccess(subject, chat.workspaceId)) return false;
  if (subject.isAdmin === true || chat.createdBy === subject.id) return true;
  if (
    permission === "read" &&
    hasGrant(subject, grants, "chat", chat.id, "read")
  )
    return true;
  return hasGrant(subject, grants, "chat", chat.id, "write");
}

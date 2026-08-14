import {
  AuthorizationError,
  assertScope,
  hasGrant,
  hasScope,
  hasWorkspaceAccess,
  type AuthSubject,
} from "@romeo/auth";

import type {
  WorkspaceFolderItem,
  WorkspaceFolderItemsBatchGroup,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { getAuthorizedChat } from "./chat-access";
import { getAuthorizedKnowledgeBase } from "./knowledge-access";

// Caps both SQL parameter fan-out and response amplification at 10,000 items.
// `hasMore` lets clients fall back to the existing per-folder endpoint when a
// folder exceeds the navigation preload rather than silently treating it as complete.
export const folderItemBatchMaxFolders = 50;
export const folderItemBatchMaxItemsPerFolder = 200;

export async function listAuthorizedFolderItemsBatch(
  repository: RomeoRepository,
  subject: AuthSubject,
  input: {
    folderIds: string[];
    limitPerFolder: number;
    workspaceId: string;
  },
): Promise<WorkspaceFolderItemsBatchGroup[]> {
  assertScope(subject, "me:read");
  if (!hasWorkspaceAccess(subject, input.workspaceId))
    throw new AuthorizationError("The workspace is outside the caller access.");
  if (
    input.folderIds.length < 1 ||
    input.folderIds.length > folderItemBatchMaxFolders ||
    new Set(input.folderIds).size !== input.folderIds.length ||
    !Number.isSafeInteger(input.limitPerFolder) ||
    input.limitPerFolder < 1 ||
    input.limitPerFolder > folderItemBatchMaxItemsPerFolder
  ) {
    throw new ApiError(
      "invalid_folder_item_batch",
      "Folder item batch query is invalid.",
      400,
    );
  }
  const folderIds = [...input.folderIds].sort();
  const folders = await repository.listAuthorizedWorkspaceFoldersByIds({
    folderIds,
    groupIds: subject.groupIds,
    isAdmin: subject.isAdmin === true,
    orgId: subject.orgId,
    principalId: subject.id,
    principalType: subject.type,
    workspaceId: input.workspaceId,
  });
  const authorizedIds = new Set(folders.map((folder) => folder.id));
  for (const folderId of folderIds) {
    if (!authorizedIds.has(folderId)) throw notFound("Folder");
  }
  return repository.listAuthorizedWorkspaceFolderItemsBatch({
    canReadAgents: hasScope(subject, "agents:read"),
    canReadChats: hasScope(subject, "chats:read"),
    canReadKnowledgeBases: hasScope(subject, "knowledge:read"),
    folderIds,
    groupIds: subject.groupIds,
    isAdmin: subject.isAdmin === true,
    limitPerFolder: input.limitPerFolder,
    orgId: subject.orgId,
    principalId: subject.id,
    principalType: subject.type,
    workspaceId: input.workspaceId,
  });
}

export async function canReadFolderItem(
  repository: RomeoRepository,
  subject: AuthSubject,
  item: Pick<WorkspaceFolderItem, "resourceId" | "resourceType">,
): Promise<boolean> {
  try {
    if (item.resourceType === "agent") {
      const grants = await repository.listResourceGrants(subject.orgId);
      const agent = await repository.getAgent(item.resourceId);
      return (
        hasScope(subject, "agents:read") &&
        agent !== undefined &&
        agent.archivedAt === undefined &&
        agent.publishedVersionId !== undefined &&
        agent.orgId === subject.orgId &&
        hasWorkspaceAccess(subject, agent.workspaceId) &&
        (hasGrant(subject, grants, "agent", agent.id, "read") ||
          hasGrant(subject, grants, "agent", agent.id, "run"))
      );
    }
    if (item.resourceType === "chat") {
      await getAuthorizedChat(repository, {
        chatId: item.resourceId,
        subject,
        scope: "chats:read",
        permission: "read",
      });
      return true;
    }
    await getAuthorizedKnowledgeBase(repository, {
      knowledgeBaseId: item.resourceId,
      subject,
      scope: "knowledge:read",
      permission: "read",
    });
    return true;
  } catch {
    return false;
  }
}

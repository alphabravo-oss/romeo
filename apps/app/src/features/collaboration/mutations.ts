import {
  collaborationAddFolderItem,
  collaborationAssignChatTag,
  collaborationCreateFavorite,
  collaborationCreateFolder,
  collaborationDeleteFavorite,
  collaborationDeleteFolder,
  collaborationDeleteFolderItem,
  collaborationRemoveChatTag,
  collaborationRevokeChatShare,
  collaborationShareChat,
  collaborationShareFile,
  collaborationShareFolder,
  collaborationShareKnowledgeBase,
  collaborationUpdateFolder,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

import type {
  ChatTag,
  CollaborationResourceGrant,
  FolderItemResourceType,
  ResourceFavorite,
  ShareTarget,
  WorkspaceFolder,
  WorkspaceFolderItem,
} from "./types";

export async function shareKnowledgeBase(input: {
  knowledgeBaseId: string;
  principalId: string;
  principalType?: ShareTarget["principalType"];
}): Promise<CollaborationResourceGrant[]> {
  configureBrowserApiClients();
  const response = await collaborationShareKnowledgeBase({
    path: { knowledgeBaseId: input.knowledgeBaseId },
    body: {
      principalType: input.principalType ?? "group",
      principalId: input.principalId,
      permissions: ["read", "use"],
    },
    throwOnError: true,
  });
  return response.data.data;
}

export async function shareChat(input: {
  chatId: string;
  principalId: string;
  principalType?: ShareTarget["principalType"];
}): Promise<CollaborationResourceGrant[]> {
  return shareChatAccess({
    chatId: input.chatId,
    principalId: input.principalId,
    principalType: input.principalType ?? "group",
    permissions: ["read", "write"],
  });
}

export async function shareChatAccess(input: {
  chatId: string;
  principalType: ShareTarget["principalType"];
  principalId: string;
  permissions: Array<"read" | "write">;
}): Promise<CollaborationResourceGrant[]> {
  configureBrowserApiClients();
  const { chatId, ...body } = input;
  const response = await collaborationShareChat({
    path: { chatId },
    body,
    throwOnError: true,
  });
  return response.data.data;
}

export async function revokeChatShare(input: {
  chatId: string;
  grantId: string;
}): Promise<CollaborationResourceGrant> {
  configureBrowserApiClients();
  const response = await collaborationRevokeChatShare({
    path: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function shareFile(input: {
  fileId: string;
  principalType: ShareTarget["principalType"];
  principalId: string;
  permissions: Array<"read" | "write">;
}): Promise<CollaborationResourceGrant[]> {
  configureBrowserApiClients();
  const { fileId, ...body } = input;
  const response = await collaborationShareFile({
    path: { fileId },
    body,
    throwOnError: true,
  });
  return response.data.data;
}

export async function favoriteResource(input: {
  resourceType: ResourceFavorite["resourceType"];
  resourceId: string;
}): Promise<ResourceFavorite> {
  configureBrowserApiClients();
  const response = await collaborationCreateFavorite({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function deleteFavorite(
  favoriteId: string,
): Promise<ResourceFavorite> {
  configureBrowserApiClients();
  const response = await collaborationDeleteFavorite({
    path: { favoriteId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function createFolder(
  input: Parameters<typeof collaborationCreateFolder>[0]["body"],
): Promise<WorkspaceFolder> {
  configureBrowserApiClients();
  const response = await collaborationCreateFolder({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function updateFolder(
  folderId: string,
  body: Parameters<typeof collaborationUpdateFolder>[0]["body"],
): Promise<WorkspaceFolder> {
  configureBrowserApiClients();
  const response = await collaborationUpdateFolder({
    path: { folderId },
    body,
    throwOnError: true,
  });
  return response.data.data;
}

export async function deleteFolder(folderId: string): Promise<WorkspaceFolder> {
  configureBrowserApiClients();
  const response = await collaborationDeleteFolder({
    path: { folderId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function shareFolder(input: {
  folderId: string;
  principalId: string;
  principalType?: ShareTarget["principalType"];
}): Promise<CollaborationResourceGrant[]> {
  configureBrowserApiClients();
  const response = await collaborationShareFolder({
    path: { folderId: input.folderId },
    body: {
      principalType: input.principalType ?? "group",
      principalId: input.principalId,
      permissions: ["read"],
    },
    throwOnError: true,
  });
  return response.data.data;
}

export async function addFolderItem(input: {
  folderId: string;
  resourceType: FolderItemResourceType;
  resourceId: string;
}): Promise<WorkspaceFolderItem> {
  configureBrowserApiClients();
  const { folderId, ...body } = input;
  const response = await collaborationAddFolderItem({
    path: { folderId },
    body,
    throwOnError: true,
  });
  return response.data.data;
}

export async function deleteFolderItem(input: {
  folderId: string;
  itemId: string;
}): Promise<WorkspaceFolderItem> {
  configureBrowserApiClients();
  const response = await collaborationDeleteFolderItem({
    path: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function assignChatTag(input: {
  chatId: string;
  name: string;
}): Promise<ChatTag[]> {
  configureBrowserApiClients();
  const response = await collaborationAssignChatTag({
    path: { chatId: input.chatId },
    body: { name: input.name },
    throwOnError: true,
  });
  return response.data.data;
}

export async function removeChatTag(input: {
  chatId: string;
  tagSlug: string;
}): Promise<ChatTag[]> {
  configureBrowserApiClients();
  const response = await collaborationRemoveChatTag({
    path: input,
    throwOnError: true,
  });
  return response.data.data;
}

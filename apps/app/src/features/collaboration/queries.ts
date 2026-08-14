import {
  collaborationGetFolder,
  collaborationListChatsForTag,
  collaborationListChatShares,
  collaborationListChatTagAssignments,
  collaborationListChatTags,
  collaborationListFavorites,
  collaborationListFileShares,
  collaborationListFolderItems,
  collaborationListFolderItemsBatch,
  collaborationListFolders,
  collaborationListFolderShares,
  collaborationListKnowledgeBaseShares,
  collaborationListShareTargets,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

import type { Chat } from "../chats/types";
import type {
  ChatTag,
  CollaborationResourceGrant,
  ResourceFavorite,
  ShareTarget,
  WorkspaceFolder,
  WorkspaceFolderItem,
  WorkspaceFolderItemsBatchGroup,
} from "./types";

export async function listShareTargets(query = ""): Promise<ShareTarget[]> {
  configureBrowserApiClients();
  const response = await collaborationListShareTargets({
    query: {
      ...(query.trim() === "" ? {} : { query: query.trim() }),
      limit: 10,
    },
    throwOnError: true,
  });
  return response.data.data;
}

export async function listKnowledgeBaseShares(
  knowledgeBaseId: string,
): Promise<CollaborationResourceGrant[]> {
  configureBrowserApiClients();
  const response = await collaborationListKnowledgeBaseShares({
    path: { knowledgeBaseId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function listChatShares(
  chatId: string,
): Promise<CollaborationResourceGrant[]> {
  configureBrowserApiClients();
  const response = await collaborationListChatShares({
    path: { chatId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function listFileShares(
  fileId: string,
): Promise<CollaborationResourceGrant[]> {
  configureBrowserApiClients();
  const response = await collaborationListFileShares({
    path: { fileId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function listFavorites(): Promise<ResourceFavorite[]> {
  configureBrowserApiClients();
  const response = await collaborationListFavorites({ throwOnError: true });
  return response.data.data;
}

export async function listFolders(
  workspaceId: string,
): Promise<WorkspaceFolder[]> {
  configureBrowserApiClients();
  const response = await collaborationListFolders({
    query: { workspaceId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function getFolder(folderId: string): Promise<WorkspaceFolder> {
  configureBrowserApiClients();
  const response = await collaborationGetFolder({
    path: { folderId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function listFolderShares(
  folderId: string,
): Promise<CollaborationResourceGrant[]> {
  configureBrowserApiClients();
  const response = await collaborationListFolderShares({
    path: { folderId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function listFolderItems(
  folderId: string,
  signal?: AbortSignal,
): Promise<WorkspaceFolderItem[]> {
  configureBrowserApiClients();
  const response = await collaborationListFolderItems({
    path: { folderId },
    ...(signal === undefined ? {} : { signal }),
    throwOnError: true,
  });
  return response.data.data;
}

export async function listFolderItemsBatch(
  input: {
    folderIds: string[];
    limitPerFolder: number;
    workspaceId: string;
  },
  signal?: AbortSignal,
): Promise<WorkspaceFolderItemsBatchGroup[]> {
  configureBrowserApiClients();
  const response = await collaborationListFolderItemsBatch({
    body: input,
    ...(signal === undefined ? {} : { signal }),
    throwOnError: true,
  });
  return response.data.data;
}

export async function listChatTags(): Promise<ChatTag[]> {
  configureBrowserApiClients();
  const response = await collaborationListChatTags({ throwOnError: true });
  return response.data.data;
}

export async function listChatsForTag(
  tagSlug: string,
  archived?: "active" | "all" | "archived",
): Promise<Chat[]> {
  configureBrowserApiClients();
  const response = await collaborationListChatsForTag({
    path: { tagSlug },
    query: archived === undefined ? {} : { archived },
    throwOnError: true,
  });
  return response.data.data;
}

export async function listChatTagAssignments(
  chatId: string,
): Promise<ChatTag[]> {
  configureBrowserApiClients();
  const response = await collaborationListChatTagAssignments({
    path: { chatId },
    throwOnError: true,
  });
  return response.data.data;
}

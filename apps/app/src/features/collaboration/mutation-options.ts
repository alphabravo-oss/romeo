import type { QueryClient } from "@tanstack/react-query";

import { apiQueryKeys } from "../../lib/api-query-options";
import type { WorkspaceFolder } from "./types";

import * as appQueryKeys from "../../lib/app-query-keys";
import {
  invalidateCachedResourceExactly,
  serverMutationOptions,
} from "../../lib/server-mutation-options";
import { invalidateFolderItemQueries } from "./folder-item-batch-query";
import {
  addFolderItem,
  assignChatTag,
  createFolder,
  deleteFavorite,
  deleteFolder,
  deleteFolderItem,
  favoriteResource,
  revokeChatShare,
  shareChat,
  shareChatAccess,
  shareFolder,
  shareKnowledgeBase,
  updateFolder,
} from "./mutations";

const invalidateAuditVariants = (client: QueryClient) =>
  invalidateCachedResourceExactly(client, appQueryKeys.auditLogs());

export function createFolderMutationOptions() {
  return serverMutationOptions({
    resource: "collaboration.folder.create",
    mutationFn: createFolder,
    invalidations: (_folder, { workspaceId }) => [
      { exact: true, queryKey: appQueryKeys.folders(workspaceId) },
    ],
  });
}

export interface DeleteFolderMutationInput {
  folderId: string;
  folderIds: readonly string[];
  workspaceId: string;
}

export function deleteFolderMutationOptions() {
  return serverMutationOptions({
    resource: "collaboration.folder.delete",
    mutationFn: ({ folderId }: DeleteFolderMutationInput) =>
      deleteFolder(folderId),
    reconcile: async (client, _folder, input) => {
      await Promise.all([
        invalidateCachedResourceExactly(
          client,
          appQueryKeys.folders(input.workspaceId),
        ),
        invalidateFolderItemQueries(client, input),
      ]);
    },
  });
}

export interface UpdateFolderInput {
  folderId: string;
  name: string;
  workspaceId: string;
}

export function updateFolderMutationOptions() {
  return serverMutationOptions<
    WorkspaceFolder,
    Error,
    UpdateFolderInput,
    WorkspaceFolder[] | undefined
  >({
    resource: "collaboration.folder.update",
    mutationFn: ({ folderId, name }) => updateFolder(folderId, { name }),
    optimistic: {
      snapshot: async (client, { workspaceId }) => {
        const queryKey = appQueryKeys.folders(workspaceId);
        await client.cancelQueries({ exact: true, queryKey });
        return client.getQueryData<WorkspaceFolder[]>(queryKey);
      },
      update: (client, { folderId, name, workspaceId }) => {
        client.setQueryData<WorkspaceFolder[]>(
          appQueryKeys.folders(workspaceId),
          (current) =>
            current?.map((folder) =>
              folder.id === folderId ? { ...folder, name } : folder,
            ),
        );
      },
      rollback: (client, snapshot, { workspaceId }) => {
        const queryKey = appQueryKeys.folders(workspaceId);
        if (snapshot === undefined)
          client.removeQueries({ exact: true, queryKey });
        else client.setQueryData(queryKey, snapshot);
      },
    },
    reconcile: (client, saved, { workspaceId }) => {
      client.setQueryData<WorkspaceFolder[]>(
        appQueryKeys.folders(workspaceId),
        (current) =>
          current?.map((folder) => (folder.id === saved.id ? saved : folder)),
      );
    },
    invalidations: (_folder, { workspaceId }) => [
      { exact: true, queryKey: appQueryKeys.folders(workspaceId) },
    ],
  });
}

export type AddFolderItemMutationInput = Parameters<typeof addFolderItem>[0] & {
  folderIds: readonly string[];
  workspaceId: string;
};

export function addFolderItemMutationOptions() {
  return serverMutationOptions({
    resource: "collaboration.folderItem.add",
    mutationFn: ({
      folderIds: _folderIds,
      workspaceId: _workspaceId,
      ...input
    }: AddFolderItemMutationInput) => addFolderItem(input),
    reconcile: async (client, _item, input) => {
      await Promise.all([
        invalidateFolderItemQueries(client, input),
        invalidateAuditVariants(client),
      ]);
    },
  });
}

export type DeleteFolderItemMutationInput = Parameters<
  typeof deleteFolderItem
>[0] & {
  folderIds: readonly string[];
  workspaceId: string;
};

export function deleteFolderItemMutationOptions() {
  return serverMutationOptions({
    resource: "collaboration.folderItem.delete",
    mutationFn: ({
      folderIds: _folderIds,
      workspaceId: _workspaceId,
      ...input
    }: DeleteFolderItemMutationInput) => deleteFolderItem(input),
    reconcile: (client, _item, input) =>
      invalidateFolderItemQueries(client, input),
  });
}

async function invalidateChatShareVariants(
  client: QueryClient,
  chatId: string,
) {
  await Promise.all([
    invalidateCachedResourceExactly(client, appQueryKeys.chatShares(chatId)),
    invalidateAuditVariants(client),
  ]);
}

export function shareChatAccessMutationOptions() {
  return serverMutationOptions({
    resource: "collaboration.chatShare.create",
    mutationFn: shareChatAccess,
    reconcile: (client, _shares, { chatId }) =>
      invalidateChatShareVariants(client, chatId),
  });
}

export function shareChatMutationOptions() {
  return serverMutationOptions({
    resource: "collaboration.chatShare.create",
    mutationFn: shareChat,
    reconcile: (client, _shares, { chatId }) =>
      invalidateChatShareVariants(client, chatId),
  });
}

export function revokeChatShareMutationOptions() {
  return serverMutationOptions({
    resource: "collaboration.chatShare.revoke",
    mutationFn: revokeChatShare,
    reconcile: (client, _share, { chatId }) =>
      invalidateChatShareVariants(client, chatId),
  });
}

export function assignChatTagMutationOptions() {
  return serverMutationOptions({
    resource: "collaboration.chatTag.assign",
    mutationFn: assignChatTag,
    reconcile: (client) =>
      invalidateCachedResourceExactly(client, appQueryKeys.chatsByTag()),
    invalidations: () => [{ exact: true, queryKey: appQueryKeys.chatTags() }],
  });
}

export function shareKnowledgeBaseMutationOptions() {
  return serverMutationOptions({
    resource: "collaboration.knowledgeBaseShare.create",
    mutationFn: shareKnowledgeBase,
    reconcile: invalidateAuditVariants,
  });
}

export function shareFolderMutationOptions() {
  return serverMutationOptions({
    resource: "collaboration.folderShare.create",
    mutationFn: shareFolder,
    reconcile: invalidateAuditVariants,
  });
}

export type FavoriteResourceMutationInput = Parameters<
  typeof favoriteResource
>[0] & { workspaceId: string };

export function favoriteResourceMutationOptions() {
  return serverMutationOptions({
    resource: "collaboration.favorite.create",
    mutationFn: ({
      workspaceId: _workspaceId,
      ...input
    }: FavoriteResourceMutationInput) => favoriteResource(input),
    invalidations: (_favorite, { workspaceId }) => [
      { exact: true, queryKey: appQueryKeys.favorites() },
      {
        exact: true,
        queryKey: apiQueryKeys.agentGallery(workspaceId),
      },
    ],
  });
}

export interface DeleteFavoriteMutationInput {
  favoriteId: string;
  workspaceId: string;
}

export function deleteFavoriteMutationOptions() {
  return serverMutationOptions({
    resource: "collaboration.favorite.delete",
    mutationFn: ({ favoriteId }: DeleteFavoriteMutationInput) =>
      deleteFavorite(favoriteId),
    invalidations: (_favorite, { workspaceId }) => [
      { exact: true, queryKey: appQueryKeys.favorites() },
      { exact: true, queryKey: apiQueryKeys.agentGallery(workspaceId) },
    ],
  });
}

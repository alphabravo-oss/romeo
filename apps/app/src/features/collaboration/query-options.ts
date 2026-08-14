import { queryOptions } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import {
  abortableQuery,
  serverQueryPolicy,
} from "../../lib/server-query-options";
import {
  listChatShares,
  listChatTags,
  listChatsForTag,
  listFavorites,
  listFolderItems,
  listFolders,
  listShareTargets,
} from "./queries";

export function shareTargetsQueryOptions(
  scope: Parameters<typeof appQueryKeys.shareTargets>[0],
  query = "",
  enabled = true,
) {
  return queryOptions({
    ...serverQueryPolicy("interactive", "shareTargets", { scope }),
    queryKey: appQueryKeys.shareTargets(scope),
    queryFn: ({ signal }) =>
      abortableQuery(signal, () => listShareTargets(query)),
    enabled,
  });
}

export function favoritesQueryOptions() {
  return queryOptions({
    ...serverQueryPolicy("interactive", "favorites"),
    queryKey: appQueryKeys.favorites(),
    queryFn: ({ signal }) => abortableQuery(signal, listFavorites),
  });
}

export function foldersQueryOptions(workspaceId?: string) {
  return queryOptions({
    ...serverQueryPolicy("interactive", "folders", { workspaceId }),
    queryKey: appQueryKeys.folders(workspaceId),
    queryFn: ({ signal }) =>
      abortableQuery(signal, () => listFolders(workspaceId!)),
    enabled: workspaceId !== undefined,
  });
}

export function folderItemsQueryOptions(
  folderId: string | undefined,
  enabled = folderId !== undefined,
) {
  return queryOptions({
    ...serverQueryPolicy("interactive", "folderItems", { folderId }),
    queryKey: appQueryKeys.folderItems(folderId ?? ""),
    queryFn: ({ signal }) => listFolderItems(folderId!, signal),
    enabled: enabled && folderId !== undefined,
  });
}

export function chatTagsQueryOptions() {
  return queryOptions({
    ...serverQueryPolicy("interactive", "chatTags"),
    queryKey: appQueryKeys.chatTags(),
    queryFn: ({ signal }) => abortableQuery(signal, listChatTags),
  });
}

export function chatsByTagQueryOptions(tag: string) {
  return queryOptions({
    ...serverQueryPolicy("interactive", "chatsByTag", { tag }),
    queryKey: appQueryKeys.chatsByTag(tag || undefined),
    queryFn: ({ signal }) => abortableQuery(signal, () => listChatsForTag(tag)),
    enabled: tag.length > 0,
  });
}

export function chatSharesQueryOptions(
  chatId: string | undefined,
  purpose?: "access",
  enabled = chatId !== undefined,
) {
  return queryOptions({
    ...serverQueryPolicy("interactive", "chatShares", { chatId, purpose }),
    queryKey: appQueryKeys.chatShares(chatId, purpose),
    queryFn: ({ signal }) =>
      abortableQuery(signal, () => listChatShares(chatId!)),
    enabled: enabled && chatId !== undefined,
    ...(purpose === "access" ? { staleTime: 30_000 } : {}),
  });
}

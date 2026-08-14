import { queryOptions, type QueryClient } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import { serverQueryPolicy } from "../../lib/server-query-options";
import { listFolderItemsBatch } from "./queries";
import type { WorkspaceFolderItemsBatchGroup } from "./types";

export const FOLDER_ITEM_BATCH_MAX_FOLDERS = 50;
export const FOLDER_ITEM_BATCH_LIMIT_PER_FOLDER = 100;
export const FOLDER_ITEM_BATCH_CONCURRENCY = 4;

export function collaborationListFolderItemsBatchQueryKey(
  workspaceId: string,
  folderIds: readonly string[],
) {
  return appQueryKeys.folderItemsBatch(
    workspaceId,
    normalizedFolderIds(folderIds),
    FOLDER_ITEM_BATCH_LIMIT_PER_FOLDER,
  );
}

export function collaborationListFolderItemsBatchOptions(
  workspaceId: string,
  folderIds: readonly string[],
  enabled = true,
) {
  const normalized = normalizedFolderIds(folderIds);
  return queryOptions({
    ...serverQueryPolicy("interactive", "folderItemsBatch", {
      folderIds: normalized,
      workspaceId,
    }),
    enabled,
    queryFn: ({ signal }) =>
      loadFolderItemBatchChunks(workspaceId, normalized, signal),
    queryKey: collaborationListFolderItemsBatchQueryKey(
      workspaceId,
      normalized,
    ),
  });
}

export function normalizedFolderIds(folderIds: readonly string[]): string[] {
  return [...new Set(folderIds)].sort();
}

export function chunkFolderIds(folderIds: readonly string[]): string[][] {
  const chunks: string[][] = [];
  for (
    let index = 0;
    index < folderIds.length;
    index += FOLDER_ITEM_BATCH_MAX_FOLDERS
  ) {
    chunks.push(folderIds.slice(index, index + FOLDER_ITEM_BATCH_MAX_FOLDERS));
  }
  return chunks;
}

export async function loadFolderItemBatchChunks(
  workspaceId: string,
  folderIds: readonly string[],
  signal: AbortSignal,
): Promise<WorkspaceFolderItemsBatchGroup[]> {
  const chunks = chunkFolderIds(folderIds);
  const results = Array.from<unknown, WorkspaceFolderItemsBatchGroup[]>(
    { length: chunks.length },
    () => [],
  );
  let nextChunkIndex = 0;

  async function worker(): Promise<void> {
    while (nextChunkIndex < chunks.length) {
      throwIfAborted(signal);
      const index = nextChunkIndex;
      nextChunkIndex += 1;
      results[index] = await listFolderItemsBatch(
        {
          folderIds: chunks[index]!,
          limitPerFolder: FOLDER_ITEM_BATCH_LIMIT_PER_FOLDER,
          workspaceId,
        },
        signal,
      );
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(FOLDER_ITEM_BATCH_CONCURRENCY, chunks.length) },
      () => worker(),
    ),
  );
  return results.flat();
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Aborted", "AbortError");
}

export function folderItemGroupsById(
  groups: readonly WorkspaceFolderItemsBatchGroup[],
): Map<string, WorkspaceFolderItemsBatchGroup> {
  return new Map(groups.map((group) => [group.folderId, group]));
}

export function shouldLoadFolderItemsOverflow(
  selectedFolderId: string,
  group: WorkspaceFolderItemsBatchGroup | undefined,
): boolean {
  return selectedFolderId.length > 0 && group?.hasMore === true;
}

export async function invalidateFolderItemQueries(
  queryClient: QueryClient,
  input: {
    folderId: string;
    folderIds: readonly string[];
    workspaceId: string;
  },
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({
      exact: true,
      queryKey: appQueryKeys.folderItems(input.folderId),
    }),
    queryClient.invalidateQueries({
      exact: true,
      queryKey: collaborationListFolderItemsBatchQueryKey(
        input.workspaceId,
        input.folderIds,
      ),
    }),
  ]);
}

import { queryOptions } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import {
  abortableQuery,
  serverQueryPolicy,
} from "../../lib/server-query-options";
import { listFilesPage } from "./queries";
import { isFileReady, type FilePage } from "./types";

export const fileLifecycleRefreshIntervalMs = 2_000;

export function fileLifecycleRefreshInterval(
  page: FilePage | undefined,
): number | false {
  return page?.items.some((file) => !isFileReady(file)) === true
    ? fileLifecycleRefreshIntervalMs
    : false;
}

export function filesPageQueryOptions(input: {
  enabled: boolean;
  page: number;
  pageSize: number;
  query: string;
  workspaceId: string | undefined;
}) {
  const { enabled, page, pageSize, query, workspaceId } = input;
  const normalizedQuery = query.trim();
  return queryOptions({
    ...serverQueryPolicy("interactive", "files", {
      page,
      ...(normalizedQuery === "" ? {} : { query: normalizedQuery }),
      workspaceId,
    }),
    queryKey: appQueryKeys.files(workspaceId, {
      page,
      query: normalizedQuery,
    }),
    queryFn: ({ signal }) =>
      abortableQuery(signal, () =>
        listFilesPage(workspaceId!, {
          limit: pageSize,
          offset: page * pageSize,
          query,
        }),
      ),
    refetchInterval: (activeQuery) =>
      fileLifecycleRefreshInterval(activeQuery.state.data),
    enabled: enabled && workspaceId !== undefined,
  });
}

export function mentionFilesQueryOptions(input: {
  enabled: boolean;
  limit: number;
  query: string;
  workspaceId: string | undefined;
}) {
  const { enabled, limit, query, workspaceId } = input;
  const normalizedQuery = query.trim();
  return queryOptions({
    ...serverQueryPolicy("interactive", "files", {
      purpose: "mention",
      ...(normalizedQuery === "" ? {} : { query: normalizedQuery }),
      workspaceId,
    }),
    queryKey: appQueryKeys.files(workspaceId, {
      purpose: "mention",
      query: normalizedQuery,
    }),
    queryFn: ({ signal }) =>
      abortableQuery(signal, async () => {
        const page = await listFilesPage(workspaceId!, {
          limit,
          offset: 0,
          query: normalizedQuery,
        });
        return { ...page, items: page.items.filter(isFileReady) };
      }),
    enabled: enabled && workspaceId !== undefined,
  });
}

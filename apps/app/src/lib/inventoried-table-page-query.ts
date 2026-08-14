import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { tablePagesQuery } from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

import * as appQueryKeys from "./app-query-keys";
import {
  abortableQuery,
  serverQueryPolicy,
} from "./server-query-options";

export interface InventoriedTablePageQuery {
  cursor?: string;
  filters: Array<{ field: string; operator: string; value?: unknown }>;
  limit: number;
  parentId?: string;
  resource: string;
  search?: string;
  sort: Array<{ direction: "asc" | "desc"; field: string }>;
  workspaceId?: string;
}

export interface InventoriedTablePage<T extends { id: string }> {
  applied: {
    filters: InventoriedTablePageQuery["filters"];
    sort: InventoriedTablePageQuery["sort"];
  };
  items: T[];
  page: {
    estimatedTotal: number;
    limit: number;
    nextCursor: string | null;
    previousCursor: string | null;
  };
  resource: string;
  summary?: Record<string, number>;
}

export async function queryInventoriedTablePage<T extends { id: string }>(
  request: InventoriedTablePageQuery,
  signal?: AbortSignal,
): Promise<InventoriedTablePage<T>> {
  configureBrowserApiClients();
  const response = await tablePagesQuery({
    body: {
      resource: request.resource,
      limit: request.limit,
      sort: request.sort,
      filters: request.filters,
      ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
      ...(request.parentId === undefined ? {} : { parentId: request.parentId }),
      ...(request.search === undefined ? {} : { search: request.search }),
      ...(request.workspaceId === undefined
        ? {}
        : { workspaceId: request.workspaceId }),
    },
    ...(signal === undefined ? {} : { signal }),
    throwOnError: true,
  });
  return response.data.data as InventoriedTablePage<T>;
}

export function inventoriedTablePageQueryOptions(
  request: InventoriedTablePageQuery,
  enabled = true,
) {
  return queryOptions({
    ...serverQueryPolicy("interactive", "tablePages", {
      resource: request.resource,
    }),
    enabled,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => queryInventoriedTablePage(request, signal),
    queryKey: appQueryKeys.tablePages(request),
  });
}

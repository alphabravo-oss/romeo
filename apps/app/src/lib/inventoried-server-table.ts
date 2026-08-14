import type { ServerTableState } from "@romeo/ui";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import {
  inventoriedTablePageQueryOptions,
  type InventoriedTablePageQuery,
} from "./inventoried-table-page-query";

type TableSort = { desc: boolean; id: string };

export interface InventoriedServerTableOptions {
  enabled?: boolean;
  filters?: InventoriedTablePageQuery["filters"];
  pageSize?: number;
  parentId?: string | undefined;
  workspaceId?: string | undefined;
}

export function useInventoriedServerTable<T extends { id: string }>(
  resource: string,
  options: InventoriedServerTableOptions = {},
) {
  const [pageSize, setPageSize] = useState(options.pageSize ?? 25);
  const [search, setSearch] = useState("");
  const [sorting, setSorting] = useState<TableSort[]>([]);
  const [cursors, setCursors] = useState<string[]>([]);
  const request = useMemo((): InventoriedTablePageQuery => {
    const cursor = cursors.at(-1);
    const parentId = options.parentId;
    const workspaceId = options.workspaceId;
    const trimmedSearch = search.trim();
    return {
      filters: options.filters ?? [],
      limit: pageSize,
      resource,
      sort: sorting.flatMap((sort) =>
        sort.id.length === 0
          ? []
          : [
              {
                direction: sort.desc ? ("desc" as const) : ("asc" as const),
                field: sort.id,
              },
            ],
      ),
      ...(cursor === undefined ? {} : { cursor }),
      ...(parentId === undefined ? {} : { parentId }),
      ...(trimmedSearch === "" ? {} : { search: trimmedSearch }),
      ...(workspaceId === undefined ? {} : { workspaceId }),
    };
  }, [
    cursors,
    options.filters,
    options.parentId,
    options.workspaceId,
    pageSize,
    resource,
    search,
    sorting,
  ]);
  const query = useQuery(
    inventoriedTablePageQueryOptions(
      request,
      options.enabled !== false,
    ),
  );
  const rows = (query.data?.items ?? []) as T[];
  const serverState = useMemo((): ServerTableState => {
    const state: ServerTableState = {
      filters: [],
      hasNextPage: query.data?.page.nextCursor != null,
      isFetching: query.isFetching,
      onNextPage: () => {
        const next = query.data?.page.nextCursor;
        if (next != null) setCursors((current) => [...current, next]);
      },
      onPageSizeChange: (next) => {
        setPageSize(next);
        setCursors([]);
      },
      onSearchChange: (updater) => {
        setSearch((current) =>
          typeof updater === "function" ? updater(current) : updater,
        );
        setCursors([]);
      },
      onSortingChange: (updater) => {
        setSorting((current) =>
          typeof updater === "function" ? updater(current) : updater,
        );
        setCursors([]);
      },
      pageIndex: cursors.length,
      pageSize,
      search,
      sorting,
      total:
        query.data === undefined
          ? { mode: "unknown" }
          : { mode: "estimated", value: query.data.page.estimatedTotal },
    };
    if (cursors.length > 0) {
      state.onPreviousPage = () =>
        setCursors((current) => current.slice(0, -1));
    }
    return state;
  }, [cursors.length, pageSize, query.data, query.isFetching, search, sorting]);

  return {
    estimatedTotal: query.data?.page.estimatedTotal ?? 0,
    isFirstPage: cursors.length === 0,
    query,
    rows,
    search,
    serverState,
    summary: query.data?.summary ?? {},
  };
}

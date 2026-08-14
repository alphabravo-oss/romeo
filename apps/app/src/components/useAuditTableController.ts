import { useCallback, useState } from "react";

import { useDebouncedValue } from "../lib/debounce";
import type { ServerTableState } from "./DataTable";
import {
  AUDIT_PAGE_SIZE,
  AUDIT_SEARCH_DEBOUNCE_MS,
  isAuditSearchTooShort,
  type AuditSortDirection,
} from "./audit-table-query";

type SortingState = ServerTableState["sorting"];
type OnChangeFn<T> = (updater: T | ((current: T) => T)) => void;

interface AuditTableControllerInput {
  pageSize?: number;
  resetKey?: string;
  search?: string;
  sortDirection?: AuditSortDirection;
  onPageSizeChange?: (pageSize: number) => void;
  onSearchChange?: (search: string) => void;
  onSortDirectionChange?: (direction: AuditSortDirection) => void;
}

export function useAuditTableController(
  options: AuditTableControllerInput = {},
) {
  const [internalPageSize, setInternalPageSize] = useState(AUDIT_PAGE_SIZE);
  const [internalSearch, setInternalSearch] = useState("");
  const [internalSortDirection, setInternalSortDirection] =
    useState<AuditSortDirection>("desc");
  const pageSize = options.pageSize ?? internalPageSize;
  const search = options.search ?? internalSearch;
  const sortDirection = options.sortDirection ?? internalSortDirection;
  const resetKey =
    options.resetKey ?? JSON.stringify([pageSize, search, sortDirection]);
  const [paging, setPaging] = useState<{
    cursors: Array<string | undefined>;
    resetKey: string;
  }>(() => ({ cursors: [undefined], resetKey }));
  const cursors = paging.resetKey === resetKey ? paging.cursors : [undefined];
  const [recoveredStaleCursor, setRecoveredStaleCursor] = useState(false);
  const rawDebouncedSearch = useDebouncedValue(
    search,
    AUDIT_SEARCH_DEBOUNCE_MS,
  );
  const debouncedSearch = isAuditSearchTooShort(rawDebouncedSearch)
    ? ""
    : rawDebouncedSearch;
  const searchTooShort = isAuditSearchTooShort(search);
  const searchReady =
    !searchTooShort && search.trim() === debouncedSearch.trim();

  const resetPaging = useCallback(() => {
    setPaging({ cursors: [undefined], resetKey });
    setRecoveredStaleCursor(false);
  }, [resetKey]);

  const onSearchChange: OnChangeFn<string> = useCallback(
    (updater) => {
      const next = typeof updater === "function" ? updater(search) : updater;
      options.onSearchChange?.(next);
      if (options.onSearchChange === undefined) setInternalSearch(next);
      resetPaging();
    },
    [options, resetPaging, search],
  );

  const onSortingChange: OnChangeFn<SortingState> = useCallback(
    (updater) => {
      const current = [{ id: "createdAt", desc: sortDirection === "desc" }];
      const nextSorting =
        typeof updater === "function" ? updater(current) : updater;
      const createdAt = nextSorting.find((sort) => sort.id === "createdAt");
      const nextDirection = createdAt?.desc === false ? "asc" : "desc";
      options.onSortDirectionChange?.(nextDirection);
      if (options.onSortDirectionChange === undefined)
        setInternalSortDirection(nextDirection);
      resetPaging();
    },
    [options, resetPaging, sortDirection],
  );

  const recoverStaleCursor = useCallback(() => {
    setPaging({ cursors: [undefined], resetKey });
    setRecoveredStaleCursor(true);
  }, [resetKey]);

  const tableState = useCallback(
    (input: {
      filters: ServerTableState["filters"];
      isFetching: boolean;
      nextCursor?: string;
      onFiltersChange?: ServerTableState["onFiltersChange"];
      total: ServerTableState["total"];
    }): ServerTableState => ({
      filters: input.filters,
      hasNextPage: input.nextCursor !== undefined,
      isFetching: input.isFetching,
      onNextPage: () => {
        if (input.nextCursor === undefined) return;
        setRecoveredStaleCursor(false);
        setPaging((current) => {
          const active =
            current.resetKey === resetKey ? current.cursors : [undefined];
          return {
            cursors:
              active[active.length - 1] === input.nextCursor
                ? active
                : [...active, input.nextCursor],
            resetKey,
          };
        });
      },
      onPageSizeChange: (nextPageSize) => {
        options.onPageSizeChange?.(nextPageSize);
        if (options.onPageSizeChange === undefined)
          setInternalPageSize(nextPageSize);
        resetPaging();
      },
      ...(input.onFiltersChange === undefined
        ? {}
        : { onFiltersChange: input.onFiltersChange }),
      ...(cursors.length > 1
        ? {
            onPreviousPage: () => {
              setRecoveredStaleCursor(false);
              setPaging((current) => ({
                cursors: current.cursors.slice(0, -1),
                resetKey,
              }));
            },
          }
        : {}),
      onSearchChange,
      onSortingChange,
      pageIndex: cursors.length - 1,
      pageSize,
      search,
      sorting: [{ id: "createdAt", desc: sortDirection === "desc" }],
      total: input.total,
    }),
    [
      cursors.length,
      options,
      onSearchChange,
      onSortingChange,
      pageSize,
      resetPaging,
      resetKey,
      search,
      sortDirection,
    ],
  );

  return {
    cursor: cursors[cursors.length - 1],
    debouncedSearch,
    pageSize,
    recoverStaleCursor,
    recoveredStaleCursor,
    resetPaging,
    search,
    searchReady,
    searchTooShort,
    sortDirection,
    tableState,
  };
}

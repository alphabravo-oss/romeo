import type {
  OnChangeFn,
  PaginationState,
  SortingState,
  Updater,
} from "@tanstack/react-table";
import type { ServerTableAuthorityScope } from "./table-authority";

export interface ServerTableFilterState {
  field: string;
  operator: string;
  value?: unknown;
}

export type ServerTableTotal =
  | { mode: "unknown" }
  | { mode: "estimated" | "exact"; value: number };

/**
 * Authoritative state for a server-owned table. The route/controller owns
 * cursor history and URL serialization; DataTable owns only presentation.
 */
export interface ServerTableState {
  authorityScope?: ServerTableAuthorityScope;
  /** Filters the server confirmed it applied. */
  filters: readonly ServerTableFilterState[];
  hasNextPage: boolean;
  isFetching?: boolean;
  isScopeTransition?: boolean;
  onFiltersChange?: (filters: readonly ServerTableFilterState[]) => void;
  onNextPage: () => void;
  onPageSizeChange: (pageSize: number) => void;
  onPreviousPage?: () => void;
  onSearchChange?: OnChangeFn<string>;
  onSortingChange?: OnChangeFn<SortingState>;
  pageIndex: number;
  pageSize: number;
  /** Filters requested by the client, kept separate from server truth. */
  requestedFilters?: readonly ServerTableFilterState[];
  retry?: () => void;
  /** Changes whenever tenant/workspace/parent/filter identity changes. */
  scopeKey?: string;
  search: string;
  /** UI column id to supported API sort field. Unmapped columns are unsortable. */
  sortFieldByColumnId?: Readonly<Record<string, string>>;
  sorting: SortingState;
  status?: "error" | "idle" | "loading" | "success";
  total: ServerTableTotal;
}

export interface ServerPagination {
  pageSize: number;
  hasNextPage: boolean;
  isFetching?: boolean;
  onNextPage: () => void;
  onPrevPage?: () => void;
  pageIndex?: number;
  total?: ServerTableTotal;
}

export function serverPaginationFromState(
  state: ServerTableState,
): ServerPagination {
  return {
    pageSize: state.pageSize,
    hasNextPage: state.hasNextPage,
    ...(state.isFetching === undefined ? {} : { isFetching: state.isFetching }),
    onNextPage: state.onNextPage,
    ...(state.onPreviousPage === undefined
      ? {}
      : { onPrevPage: state.onPreviousPage }),
    pageIndex: state.pageIndex,
    total: state.total,
  };
}

export function serverPaginationChangeHandler(
  state: ServerTableState,
): OnChangeFn<PaginationState> {
  return (updater: Updater<PaginationState>) => {
    const current = { pageIndex: state.pageIndex, pageSize: state.pageSize };
    const next = typeof updater === "function" ? updater(current) : updater;
    if (next.pageSize !== current.pageSize)
      state.onPageSizeChange(next.pageSize);
  };
}

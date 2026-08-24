import type {
  ColumnDef,
  OnChangeFn,
  PaginationState,
  SortingState,
} from "@tanstack/react-table";
import type React from "react";

import type { ServerPagination, ServerTableState } from "./server-table-state";
import type { DataTableAuthority } from "./table-authority";

export interface DataTableLabels {
  approximate: string;
  bulkActions: string;
  columns: string;
  comfortable: string;
  compact: string;
  density: string;
  defaultExportFileName: string;
  error: string;
  exportCsv: string;
  loading: string;
  nextPage: string;
  noMatches: string;
  noRecords: string;
  of: string;
  options: string;
  operationFailed: string;
  page: string;
  previousPage: string;
  resetView: string;
  retry: string;
  results: string;
  rowsPerPage: string;
  search: string;
  searchPlaceholder: string;
  selectAllRows: string;
  selected: string;
  selectRow: string;
  shown: string;
  savedViews: string;
  saveView: string;
  viewName: string;
  deleteView: string;
  deselectRow: string;
  total: string;
  defaultView: string;
  shareView: string;
  unshareView: string;
  serverAuthorityUnavailable: string;
  undo: string;
  viewDeleted: string;
}

export interface DataTableProps<T> {
  authority?: DataTableAuthority;
  bulkActions?: (
    selectedIds: string[],
    clearSelection: () => void,
  ) => React.ReactNode;
  columns: ColumnDef<T, any>[];
  data: T[];
  empty?: string;
  enableRowSelection?: boolean;
  exportFileName?: false | string;
  formatNumber?: (value: number) => React.ReactNode;
  getRowId?: (row: T, index: number) => string;
  labels: DataTableLabels;
  globalFilter?: string;
  manualFiltering?: boolean;
  manualSorting?: boolean;
  maxBodyHeight?: number;
  minTableWidth?: number;
  onGlobalFilterChange?: OnChangeFn<string>;
  onPaginationChange?: OnChangeFn<PaginationState>;
  onRowActivate?: (row: T) => void;
  onSortingChange?: OnChangeFn<SortingState>;
  pagination?: PaginationState;
  pageSize?: number;
  preferenceKey?: string;
  rowAriaLabel?: (row: T) => string;
  rowHref?: (row: T) => string;
  searchVisibility?: "auto" | "always" | "hidden";
  serverPagination?: ServerPagination;
  serverState?: ServerTableState;
  sorting?: SortingState;
}

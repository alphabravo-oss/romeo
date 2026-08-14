import {
  type ColumnDef,
  type OnChangeFn,
  type PaginationState,
  type RowSelectionState,
  type SortingState,
  createColumnHelper,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import type React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Checkbox } from "./forms";
import { useEffect, useMemo, useRef, useState } from "react";
import { DataTableControls } from "./data-table-controls";
import { columnPreferenceIds } from "./data-table-columns";
import { DataTableGrid } from "./data-table-grid";
import { ClientTablePager, ServerTablePager } from "./data-table-pagination";
import { downloadCsv, serializeTableCsv } from "./table-csv";
import {
  defaultTablePreferences,
  readTablePreferences,
  readTableSavedViews,
  removeTablePreferences,
  type TableSavedView,
  tablePreferenceIdentity,
  writeTablePreferences,
  writeTableSavedViews,
} from "./table-preferences";
import {
  serverPaginationChangeHandler,
  serverPaginationFromState,
  type ServerPagination,
  type ServerTableState,
} from "./server-table-state";

export { createColumnHelper };
export type { ColumnDef };

/**
 * Server-driven pagination. When passed, the internal client-side paginator is
 * disabled and driven by parent callbacks. `hasNextPage` and the
 * optional `onPrevPage` control the nav buttons; `isFetching` disables them
 * mid-request. `pageSize` is used only for display sizing hints.
 */
export interface DataTableLabels {
  columns: string;
  comfortable: string;
  compact: string;
  density: string;
  exportCsv: string;
  loading: string;
  nextPage: string;
  noMatches: string;
  noRecords: string;
  of: string;
  options: string;
  page: string;
  previousPage: string;
  resetView: string;
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
  total: string;
}

export interface DataTableProps<T> {
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
  searchVisibility?: "auto" | "always" | "hidden";
  serverPagination?: ServerPagination;
  serverState?: ServerTableState;
  sorting?: SortingState;
}

/**
 * Headless TanStack Table v8, styled Linear-dense: sticky header, hairline
 * rows, click-to-sort. Auto-adds a global search when there are enough rows,
 * and paginates past `pageSize`. Pass `maxBodyHeight` to virtualize instead
 * (for very long logs). Small tables stay clean — no chrome.
 *
 * Opt-in extras (all additive, default off):
 * - `serverPagination`: disable the client paginator and render an API-driven
 *   pager from callbacks instead.
 * - `enableRowSelection` + `bulkActions`: add a leading checkbox column and a
 *   bulk toolbar over the table when rows are selected. Rows need stable ids —
 *   pass `getRowId` if the row objects don't have an `id` field.
 */
export function DataTable<T>({
  columns,
  data,
  empty,
  exportFileName = "romeo-table.csv",
  maxBodyHeight,
  minTableWidth,
  globalFilter: controlledGlobalFilter,
  manualFiltering = false,
  manualSorting = false,
  onGlobalFilterChange,
  onPaginationChange,
  onRowActivate,
  onSortingChange,
  pagination: controlledPagination,
  pageSize = 25,
  preferenceKey,
  rowAriaLabel,
  searchVisibility = "auto",
  serverPagination,
  serverState,
  sorting: controlledSorting,
  enableRowSelection = false,
  bulkActions,
  formatNumber = String,
  getRowId,
  labels,
}: DataTableProps<T>) {
  const resolvedEmpty = empty ?? labels.noRecords;
  const dataColumnIds = useMemo(
    () => columnPreferenceIds(columns, false),
    [columns],
  );
  const preferenceColumnIds = useMemo(
    () => columnPreferenceIds(columns, true),
    [columns],
  );
  const resolvedPreferenceKey =
    preferenceKey ?? tablePreferenceIdentity(dataColumnIds);
  const [initialPreferences] = useState(() =>
    readTablePreferences(
      resolvedPreferenceKey,
      new Set(preferenceColumnIds),
      pageSize,
    ),
  );
  const [internalSorting, setInternalSorting] = useState<SortingState>([]);
  const [internalGlobalFilter, setInternalGlobalFilter] = useState("");
  const [columnVisibility, setColumnVisibility] = useState(
    initialPreferences.columnVisibility,
  );
  const [density, setDensity] = useState(initialPreferences.density);
  const [internalPagination, setInternalPagination] = useState<PaginationState>(
    {
      pageIndex: 0,
      pageSize: initialPreferences.pageSize,
    },
  );
  const sorting = serverState?.sorting ?? controlledSorting ?? internalSorting;
  const globalFilter =
    serverState?.search ?? controlledGlobalFilter ?? internalGlobalFilter;
  const pagination = serverState
    ? { pageIndex: serverState.pageIndex, pageSize: serverState.pageSize }
    : (controlledPagination ?? internalPagination);
  const updateSorting =
    serverState === undefined
      ? (onSortingChange ?? setInternalSorting)
      : (serverState.onSortingChange ?? ignoreChange);
  const updateGlobalFilter =
    serverState === undefined
      ? (onGlobalFilterChange ?? setInternalGlobalFilter)
      : (serverState.onSearchChange ?? ignoreChange);
  const updatePagination = serverState
    ? serverPaginationChangeHandler(serverState)
    : (onPaginationChange ?? setInternalPagination);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [savedViews, setSavedViews] = useState<TableSavedView[]>(() =>
    readTableSavedViews(
      resolvedPreferenceKey,
      new Set(preferenceColumnIds),
      pageSize,
    ),
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualize = maxBodyHeight !== undefined;
  // Server pagination is authoritative: the parent owns page state, so the
  // internal client paginator must be off.
  const resolvedServerPagination = serverState
    ? serverPaginationFromState(serverState)
    : serverPagination;
  const clientPaginate = !virtualize && !resolvedServerPagination;

  useEffect(() => {
    writeTablePreferences(resolvedPreferenceKey, {
      columnVisibility,
      density,
      pageSize: pagination.pageSize,
    });
  }, [columnVisibility, density, pagination.pageSize, resolvedPreferenceKey]);

  const selectionColumn: ColumnDef<T, any> = {
    id: "__select__",
    enableSorting: false,
    enableHiding: false,
    size: 36,
    header: ({ table }) => (
      <Checkbox
        aria-label={labels.selectAllRows}
        checked={
          table.getIsAllRowsSelected()
            ? true
            : table.getIsSomeRowsSelected()
              ? "indeterminate"
              : false
        }
        className="rm-table-select"
        onCheckedChange={(checked) =>
          table.toggleAllRowsSelected(checked === true)
        }
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        aria-label={labels.selectRow}
        checked={row.getIsSelected()}
        className="rm-table-select"
        disabled={!row.getCanSelect()}
        onCheckedChange={(checked) => row.toggleSelected(checked === true)}
      />
    ),
  };

  const resolvedColumns = enableRowSelection
    ? [selectionColumn, ...columns]
    : columns;

  const table = useReactTable({
    columns: resolvedColumns,
    data,
    state: {
      sorting,
      globalFilter,
      columnVisibility,
      rowSelection,
      pagination,
    },
    enableRowSelection,
    enableSorting:
      serverState === undefined || serverState.onSortingChange !== undefined,
    ...(getRowId ? { getRowId } : {}),
    onSortingChange: updateSorting,
    onGlobalFilterChange: updateGlobalFilter,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: updatePagination,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: serverState !== undefined || manualSorting,
    manualFiltering: serverState !== undefined || manualFiltering,
    ...(serverState !== undefined || manualSorting
      ? {}
      : { getSortedRowModel: getSortedRowModel() }),
    ...(serverState !== undefined || manualFiltering
      ? {}
      : { getFilteredRowModel: getFilteredRowModel() }),
    ...(clientPaginate
      ? { getPaginationRowModel: getPaginationRowModel() }
      : {}),
  });

  const rows = table.getRowModel().rows;
  const showSearch =
    (serverState === undefined || serverState.onSearchChange !== undefined) &&
    (searchVisibility === "always" ||
      (searchVisibility === "auto" && data.length > 8));
  const showPager = clientPaginate && table.getPageCount() > 1;

  const selectedRows = table.getSelectedRowModel().rows;
  const selectedIds = selectedRows.map((r) => r.id);
  const clearSelection = () => table.resetRowSelection();
  const showBulkToolbar =
    enableRowSelection && bulkActions != null && selectedIds.length > 0;

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 41,
    overscan: 12,
    enabled: virtualize,
  });
  const virtualItems = virtualize ? virtualizer.getVirtualItems() : [];
  const firstItem = virtualItems[0];
  const lastItem = virtualItems[virtualItems.length - 1];
  const padTop = firstItem ? firstItem.start : 0;
  const padBottom = lastItem ? virtualizer.getTotalSize() - lastItem.end : 0;

  const filteredRows = table.getFilteredRowModel().rows;
  const exportableColumns = table
    .getVisibleLeafColumns()
    .filter(
      (column) => column.id !== "__select__" && column.accessorFn !== undefined,
    );
  const canExport =
    exportFileName !== false &&
    exportableColumns.length > 0 &&
    filteredRows.length > 0;

  function exportRows() {
    if (!canExport) return;
    const exportRows = table.getPrePaginationRowModel().rows;
    const csv = serializeTableCsv(
      exportableColumns.map((column) => ({
        header:
          typeof column.columnDef.header === "string"
            ? column.columnDef.header
            : column.id,
        value: (row: (typeof exportRows)[number]) => row.getValue(column.id),
      })),
      exportRows,
    );
    downloadCsv(csv, exportFileName);
  }

  function resetView() {
    const defaults = defaultTablePreferences(pageSize);
    removeTablePreferences(resolvedPreferenceKey);
    setColumnVisibility(defaults.columnVisibility);
    setDensity(defaults.density);
    updatePagination({ pageIndex: 0, pageSize: defaults.pageSize });
    updateSorting([]);
    updateGlobalFilter("");
    serverState?.onFiltersChange?.([]);
    setRowSelection({});
  }

  function saveView(name: string) {
    const savedView: TableSavedView = {
      columnVisibility,
      density,
      globalFilter,
      name,
      pageSize: pagination.pageSize,
      sorting,
    };
    setSavedViews((current) => {
      const next = [
        ...current.filter(
          (view) => view.name.toLocaleLowerCase() !== name.toLocaleLowerCase(),
        ),
        savedView,
      ].sort((left, right) => left.name.localeCompare(right.name));
      writeTableSavedViews(resolvedPreferenceKey, next);
      return next;
    });
  }

  function applySavedView(view: TableSavedView) {
    setColumnVisibility(view.columnVisibility);
    setDensity(view.density);
    updateGlobalFilter(view.globalFilter);
    updateSorting(view.sorting);
    updatePagination({ pageIndex: 0, pageSize: view.pageSize });
    setRowSelection({});
  }

  function deleteSavedView(name: string) {
    setSavedViews((current) => {
      const next = current.filter((view) => view.name !== name);
      writeTableSavedViews(resolvedPreferenceKey, next);
      return next;
    });
  }

  const summary = [
    `${formatNumber(filteredRows.length)} ${labels.results}`,
    filteredRows.length === data.length
      ? undefined
      : `${formatNumber(data.length)} ${labels.total}`,
    clientPaginate
      ? `${labels.page} ${formatNumber(pagination.pageIndex + 1)} ${labels.of} ${formatNumber(Math.max(table.getPageCount(), 1))}`
      : undefined,
    selectedIds.length > 0
      ? `${formatNumber(selectedIds.length)} ${labels.selected}`
      : undefined,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className="rm-table-block"
      data-page-size={pagination.pageSize}
      data-row-count={data.length}
      data-server-paginated={resolvedServerPagination !== undefined}
      data-virtualized={virtualize}
    >
      <DataTableControls
        canExport={canExport}
        showPageSize={clientPaginate || serverState !== undefined}
        density={density}
        globalFilter={globalFilter}
        labels={labels}
        onExport={exportRows}
        onApplySavedView={applySavedView}
        onDeleteSavedView={deleteSavedView}
        onReset={resetView}
        onSaveView={saveView}
        pageSize={pagination.pageSize}
        setDensity={setDensity}
        savedViews={savedViews}
        showExport={exportFileName !== false && serverState === undefined}
        showSearch={showSearch}
        table={table}
      />
      <span aria-live="polite" className="sr-only" role="status">
        {summary}
      </span>

      {showBulkToolbar ? (
        <div className="rm-table-bulk" role="toolbar">
          <span className="rm-table-bulk-count">
            {formatNumber(selectedIds.length)} {labels.selected}
          </span>
          <div className="rm-table-bulk-actions">
            {bulkActions!(selectedIds, clearSelection)}
          </div>
        </div>
      ) : null}

      <DataTableGrid
        density={density}
        empty={resolvedEmpty}
        globalFilter={globalFilter}
        maxBodyHeight={maxBodyHeight}
        minTableWidth={minTableWidth}
        noMatches={labels.noMatches}
        onRowActivate={onRowActivate}
        padBottom={padBottom}
        padTop={padTop}
        rowAriaLabel={rowAriaLabel}
        rows={rows}
        scrollRef={scrollRef}
        table={table}
        virtualItems={virtualItems}
        virtualize={virtualize}
      />

      {showPager ? (
        <ClientTablePager
          formatNumber={formatNumber}
          labels={labels}
          table={table}
        />
      ) : null}

      {resolvedServerPagination ? (
        <ServerTablePager
          dataLength={data.length}
          formatNumber={formatNumber}
          labels={labels}
          pagination={resolvedServerPagination}
        />
      ) : null}
    </div>
  );
}

function ignoreChange(): void {}

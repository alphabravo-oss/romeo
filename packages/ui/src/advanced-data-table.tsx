import {
  type ColumnDef,
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
import { useVirtualizer } from "@tanstack/react-virtual";
import { Button } from "./button";
import { useEffect, useMemo, useRef, useState } from "react";
import { DataTableControls } from "./data-table-controls";
import { columnPreferenceIds } from "./data-table-columns";
import { DataTableGrid } from "./data-table-grid";
import { createSelectionColumn } from "./data-table-selection-column";
import { ClientTablePager, ServerTablePager } from "./data-table-pagination";
import { downloadCsv, serializeTableCsv } from "./table-csv";
import {
  defaultTablePreferences,
  readTablePreferences,
  removeTablePreferences,
  type TableSavedView,
  tablePreferenceIdentity,
  writeTablePreferences,
} from "./table-preferences";
import { useDataTableAuthority } from "./use-data-table-authority";
import {
  serverPaginationChangeHandler,
  serverPaginationFromState,
} from "./server-table-state";
import type { DataTableProps } from "./advanced-data-table-types";

export { createColumnHelper };
export type { ColumnDef };
export type {
  DataTableLabels,
  DataTableProps,
} from "./advanced-data-table-types";

/**
 * Server-driven pagination. When passed, the internal client-side paginator is
 * disabled and driven by parent callbacks. `hasNextPage` and the
 * optional `onPrevPage` control the nav buttons; `isFetching` disables them
 * mid-request. `pageSize` is used only for display sizing hints.
 */
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
  authority,
  columns,
  data,
  empty,
  exportFileName,
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
  rowHref,
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
  const validColumnIds = useMemo(
    () => new Set(preferenceColumnIds),
    [preferenceColumnIds],
  );
  const tableAuthority = useDataTableAuthority({
    authority,
    initialPageSize: pageSize,
    operationFailureMessage: labels.operationFailed,
    preferenceKey: resolvedPreferenceKey,
    serverAuthorityUnavailableMessage: labels.serverAuthorityUnavailable,
    validColumnIds,
  });
  const resolvedExportFileName = exportFileName ?? labels.defaultExportFileName;
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualize = maxBodyHeight !== undefined;
  // Server pagination is authoritative: the parent owns page state, so the
  // internal client paginator must be off.
  const resolvedServerPagination = serverState
    ? serverPaginationFromState(serverState)
    : serverPagination;
  const clientPaginate = !virtualize && !resolvedServerPagination;

  useEffect(() => {
    setRowSelection({});
  }, [serverState?.scopeKey]);

  useEffect(() => {
    writeTablePreferences(resolvedPreferenceKey, {
      columnVisibility,
      density,
      pageSize: pagination.pageSize,
    });
  }, [columnVisibility, density, pagination.pageSize, resolvedPreferenceKey]);

  const { deselectRow, selectAllRows, selectRow } = labels;
  const selectionColumn = useMemo(
    () =>
      createSelectionColumn({
        labels: { deselectRow, selectAllRows, selectRow },
        rowAriaLabel,
      }),
    [deselectRow, rowAriaLabel, selectAllRows, selectRow],
  );

  const serverColumns = useMemo(
    () =>
      serverState?.sortFieldByColumnId === undefined
        ? columns
        : columns.map((column) => {
            const id = columnDefinitionId(column);
            return {
              ...column,
              enableSorting:
                column.enableSorting !== false &&
                id !== undefined &&
                serverState.sortFieldByColumnId?.[id] !== undefined,
            };
          }),
    [columns, serverState?.sortFieldByColumnId],
  );
  const resolvedColumns = useMemo(
    () =>
      enableRowSelection ? [selectionColumn, ...serverColumns] : serverColumns,
    [enableRowSelection, selectionColumn, serverColumns],
  );

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
    enableRowSelection &&
    bulkActions != null &&
    selectedIds.length > 0 &&
    (serverState === undefined || serverState.status === "success");

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
    resolvedExportFileName !== false &&
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
    downloadCsv(csv, resolvedExportFileName);
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

  function currentView(name: string): TableSavedView {
    const savedView: TableSavedView = {
      columnVisibility,
      density,
      filters: [
        ...(serverState?.requestedFilters ?? serverState?.filters ?? []),
      ],
      globalFilter,
      name,
      pageSize: pagination.pageSize,
      sorting,
    };
    return savedView;
  }

  function applySavedView(view: TableSavedView) {
    setColumnVisibility(view.columnVisibility);
    setDensity(view.density);
    updateGlobalFilter(view.globalFilter);
    updateSorting(view.sorting);
    updatePagination({ pageIndex: 0, pageSize: view.pageSize });
    serverState?.onFiltersChange?.(view.filters ?? []);
    setRowSelection({});
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
  const accessibleTotal = serverState?.total ?? {
    mode: "exact" as const,
    value: filteredRows.length,
  };
  const totalSummary =
    accessibleTotal.mode === "unknown"
      ? undefined
      : `${accessibleTotal.mode === "estimated" ? `${labels.approximate} ` : ""}${formatNumber(accessibleTotal.value)} ${labels.total}`;

  return (
    <div
      aria-busy={
        serverState?.status === "loading" ||
        serverState?.isScopeTransition === true
      }
      className="rm-table-block"
      data-page-size={pagination.pageSize}
      data-row-count={data.length}
      data-server-paginated={resolvedServerPagination !== undefined}
      data-virtualized={virtualize}
    >
      <DataTableControls
        canExport={canExport && !tableAuthority.pending}
        showPageSize={clientPaginate || serverState !== undefined}
        density={density}
        globalFilter={globalFilter}
        labels={labels}
        authorityError={tableAuthority.error}
        authorityPending={tableAuthority.pending}
        onExport={() => {
          if (authority === undefined) exportRows();
          else
            void tableAuthority.exportView(
              currentView("export"),
              serverState?.total.mode === "unknown"
                ? filteredRows.length
                : (serverState?.total.value ?? filteredRows.length),
            );
        }}
        onApplySavedView={applySavedView}
        onDeleteSavedView={(view) => void tableAuthority.deleteView(view)}
        onReset={resetView}
        onSaveView={(name) => tableAuthority.saveView(currentView(name))}
        onSetDefaultView={(view, isDefault) =>
          void tableAuthority.setDefaultView(view, isDefault)
        }
        onSetViewVisibility={(view, visibility) =>
          void tableAuthority.setViewVisibility(view, visibility)
        }
        onUndoDeleteSavedView={tableAuthority.undoDeleteView}
        pageSize={pagination.pageSize}
        setDensity={setDensity}
        savedViews={tableAuthority.savedViews}
        pendingDeletedView={tableAuthority.pendingDeletedView}
        showExport={
          resolvedExportFileName !== false &&
          (serverState === undefined || authority !== undefined)
        }
        showSearch={showSearch}
        table={table}
      />
      <span aria-live="polite" className="sr-only" role="status">
        {[summary, totalSummary, tableAuthority.statusMessage]
          .filter(Boolean)
          .join(" · ")}
      </span>

      {showBulkToolbar ? (
        <div
          aria-label={labels.bulkActions}
          className="rm-table-bulk"
          role="toolbar"
        >
          <span className="rm-table-bulk-count">
            {formatNumber(selectedIds.length)} {labels.selected}
          </span>
          <div className="rm-table-bulk-actions">
            {bulkActions!(selectedIds, clearSelection)}
          </div>
        </div>
      ) : null}

      {serverState?.status === "error" ? (
        <div className="rm-table-empty" role="alert">
          <p>{labels.error}</p>
          {serverState.retry ? (
            <Button onClick={serverState.retry} variant="secondary">
              {labels.retry}
            </Button>
          ) : null}
        </div>
      ) : (
        <DataTableGrid
          density={density}
          empty={
            serverState?.status === "loading" ||
            serverState?.isScopeTransition === true
              ? labels.loading
              : resolvedEmpty
          }
          globalFilter={globalFilter}
          maxBodyHeight={maxBodyHeight}
          minTableWidth={minTableWidth}
          noMatches={labels.noMatches}
          onRowActivate={
            serverState === undefined || serverState.status === "success"
              ? onRowActivate
              : undefined
          }
          padBottom={padBottom}
          padTop={padTop}
          rowAriaLabel={rowAriaLabel}
          rowHref={rowHref}
          rows={rows}
          pageIndex={pagination.pageIndex}
          pageSize={pagination.pageSize}
          scrollRef={scrollRef}
          table={table}
          virtualItems={virtualItems}
          virtualize={virtualize}
          total={accessibleTotal}
        />
      )}

      {showPager ? (
        <ClientTablePager
          formatNumber={formatNumber}
          labels={labels}
          table={table}
        />
      ) : null}

      {resolvedServerPagination && serverState?.status !== "error" ? (
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

function columnDefinitionId<T>(column: ColumnDef<T, any>): string | undefined {
  if ("id" in column && typeof column.id === "string") return column.id;
  if ("accessorKey" in column && typeof column.accessorKey === "string") {
    return column.accessorKey;
  }
  return undefined;
}

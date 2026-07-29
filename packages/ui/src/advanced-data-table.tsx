import {
  type ColumnDef,
  type PaginationState,
  type RowSelectionState,
  type SortingState,
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import type React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import ArrowDown from "lucide-react/dist/esm/icons/arrow-down.mjs";
import ArrowUp from "lucide-react/dist/esm/icons/arrow-up.mjs";
import ChevronsUpDown from "lucide-react/dist/esm/icons/chevrons-up-down.mjs";
import { Button } from "./button";
import { Checkbox } from "./forms";
import { useEffect, useMemo, useRef, useState } from "react";
import { DataTableControls } from "./data-table-controls";
import { ClientTablePager, ServerTablePager } from "./data-table-pagination";
import { downloadCsv, serializeTableCsv } from "./table-csv";
import {
  defaultTablePreferences,
  readTablePreferences,
  removeTablePreferences,
  tablePreferenceIdentity,
  writeTablePreferences,
} from "./table-preferences";

export { createColumnHelper };
export type { ColumnDef };

/**
 * Server-driven pagination. When passed, the internal client-side paginator is
 * disabled and driven by parent callbacks. `hasNextPage` and the
 * optional `onPrevPage` control the nav buttons; `isFetching` disables them
 * mid-request. `pageSize` is used only for display sizing hints.
 */
export interface ServerPagination {
  pageSize: number;
  hasNextPage: boolean;
  isFetching?: boolean;
  onNextPage: () => void;
  onPrevPage?: () => void;
}

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
  maxBodyHeight?: number;
  minTableWidth?: number;
  pageSize?: number;
  preferenceKey?: string;
  serverPagination?: ServerPagination;
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
  pageSize = 25,
  preferenceKey,
  serverPagination,
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
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [columnVisibility, setColumnVisibility] = useState(
    initialPreferences.columnVisibility,
  );
  const [density, setDensity] = useState(initialPreferences.density);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: initialPreferences.pageSize,
  });
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualize = maxBodyHeight !== undefined;
  // Server pagination is authoritative: the parent owns page state, so the
  // internal client paginator must be off.
  const clientPaginate = !virtualize && !serverPagination;

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
    ...(getRowId ? { getRowId } : {}),
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    ...(clientPaginate
      ? { getPaginationRowModel: getPaginationRowModel() }
      : {}),
  });

  const rows = table.getRowModel().rows;
  const showSearch = data.length > 8;
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

  const renderRow = (row: (typeof rows)[number]) => (
    <tr key={row.id}>
      {row.getVisibleCells().map((cell) => (
        <td key={cell.id}>
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </td>
      ))}
    </tr>
  );

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
    setPagination({ pageIndex: 0, pageSize: defaults.pageSize });
    setSorting([]);
    setGlobalFilter("");
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

  return (
    <div
      className="rm-table-block"
      data-page-size={pagination.pageSize}
      data-row-count={data.length}
      data-server-paginated={serverPagination !== undefined}
      data-virtualized={virtualize}
    >
      <DataTableControls
        canExport={canExport}
        clientPaginate={clientPaginate}
        density={density}
        globalFilter={globalFilter}
        labels={labels}
        onExport={exportRows}
        onReset={resetView}
        pageSize={pagination.pageSize}
        setDensity={setDensity}
        showExport={exportFileName !== false}
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

      <div
        className={`rm-table-wrap ${density === "compact" ? "compact" : ""}`}
        ref={scrollRef}
        style={
          virtualize
            ? { maxHeight: maxBodyHeight, overflowY: "auto" }
            : undefined
        }
      >
        <table
          aria-rowcount={rows.length + 1}
          className="rm-table"
          style={minTableWidth ? { minWidth: minTableWidth } : undefined}
        >
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  const toggleSort = header.column.getToggleSortingHandler();
                  const inner = (
                    <span className="rm-th-inner">
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                      {canSort ? (
                        <span className="rm-th-sort">
                          {sorted === "asc" ? (
                            <ArrowUp size={12} />
                          ) : sorted === "desc" ? (
                            <ArrowDown size={12} />
                          ) : (
                            <ChevronsUpDown size={12} />
                          )}
                        </span>
                      ) : null}
                    </span>
                  );
                  return (
                    <th
                      aria-sort={
                        canSort
                          ? sorted === "asc"
                            ? "ascending"
                            : sorted === "desc"
                              ? "descending"
                              : "none"
                          : undefined
                      }
                      className={canSort ? "rm-th-sortable" : undefined}
                      key={header.id}
                      style={{ width: header.getSize() || undefined }}
                    >
                      {canSort ? (
                        <Button
                          className="rm-th-sort-btn"
                          onClick={toggleSort}
                          variant="ghost"
                        >
                          {inner}
                        </Button>
                      ) : (
                        inner
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  className="rm-table-empty"
                  colSpan={table.getVisibleLeafColumns().length}
                >
                  {globalFilter ? labels.noMatches : resolvedEmpty}
                </td>
              </tr>
            ) : virtualize ? (
              <>
                {padTop > 0 ? (
                  <tr>
                    <td
                      colSpan={table.getVisibleLeafColumns().length}
                      style={{ height: padTop }}
                    />
                  </tr>
                ) : null}
                {virtualItems.map((vi) => {
                  const row = rows[vi.index];
                  return row ? renderRow(row) : null;
                })}
                {padBottom > 0 ? (
                  <tr>
                    <td
                      colSpan={table.getVisibleLeafColumns().length}
                      style={{ height: padBottom }}
                    />
                  </tr>
                ) : null}
              </>
            ) : (
              rows.map(renderRow)
            )}
          </tbody>
        </table>
      </div>

      {showPager ? (
        <ClientTablePager
          formatNumber={formatNumber}
          labels={labels}
          table={table}
        />
      ) : null}

      {serverPagination ? (
        <ServerTablePager
          dataLength={data.length}
          formatNumber={formatNumber}
          labels={labels}
          pagination={serverPagination}
        />
      ) : null}
    </div>
  );
}

function columnPreferenceIds<T>(
  columns: readonly ColumnDef<T, any>[],
  includeDisplay: boolean,
): string[] {
  return columns.flatMap((column) => {
    if ("columns" in column && Array.isArray(column.columns)) {
      return columnPreferenceIds(column.columns, includeDisplay);
    }
    if ("accessorKey" in column && column.accessorKey !== undefined) {
      return [String(column.accessorKey)];
    }
    return column.id !== undefined && (includeDisplay || "accessorFn" in column)
      ? [column.id]
      : [];
  });
}

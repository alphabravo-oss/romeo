import {
  type ColumnDef,
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
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { Button, IconButton } from "./button";
import { Checkbox, Input } from "./forms";
import { Popover } from "./overlays";
import { useRef, useState } from "react";

// re-export so panels build columns without importing the lib directly
export { createColumnHelper };
export type { ColumnDef };

/**
 * Server-driven pagination. When passed, the internal client-side paginator is
 * disabled and the pager is driven entirely by these callbacks — the parent is
 * responsible for fetching each page from the API. `hasNextPage` and the
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
  loading: string;
  nextPage: string;
  noMatches: string;
  noRecords: string;
  of: string;
  options: string;
  previousPage: string;
  search: string;
  searchPlaceholder: string;
  selectAllRows: string;
  selected: string;
  selectRow: string;
  shown: string;
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
  formatNumber?: (value: number) => React.ReactNode;
  getRowId?: (row: T, index: number) => string;
  labels: DataTableLabels;
  maxBodyHeight?: number;
  minTableWidth?: number;
  pageSize?: number;
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
  maxBodyHeight,
  minTableWidth,
  pageSize = 25,
  serverPagination,
  enableRowSelection = false,
  bulkActions,
  formatNumber = String,
  getRowId,
  labels,
}: DataTableProps<T>) {
  const resolvedEmpty = empty ?? labels.noRecords;
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >({});
  const [density, setDensity] = useState<"comfortable" | "compact">(
    "comfortable",
  );
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualize = maxBodyHeight !== undefined;
  // Server pagination is authoritative: the parent owns page state, so the
  // internal client paginator must be off.
  const clientPaginate = !virtualize && !serverPagination;

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
    state: { sorting, globalFilter, columnVisibility, rowSelection },
    enableRowSelection,
    ...(getRowId ? { getRowId } : {}),
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    ...(clientPaginate
      ? { getPaginationRowModel: getPaginationRowModel() }
      : {}),
    initialState: { pagination: { pageSize } },
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

  const hideableColumns = table
    .getAllLeafColumns()
    .filter((c) => c.getCanHide() && typeof c.columnDef.header === "string");

  return (
    <div
      className="rm-table-block"
      data-page-size={pageSize}
      data-row-count={data.length}
      data-server-paginated={serverPagination !== undefined}
      data-virtualized={virtualize}
    >
      {showSearch ? (
        <div className="rm-table-toolbar">
          <div className="rm-table-search">
            <Search aria-hidden size={14} />
            <Input
              aria-label={labels.search}
              onChange={(e) => table.setGlobalFilter(e.currentTarget.value)}
              placeholder={labels.searchPlaceholder}
              value={globalFilter}
            />
          </div>
          <div className="rm-table-view">
            <Popover
              align="end"
              className="rm-table-view-menu"
              trigger={
                <IconButton
                  aria-label={labels.options}
                  className="rm-icon-button rm-table-view-btn"
                  variant="ghost"
                >
                  <SlidersHorizontal aria-hidden size={15} />
                </IconButton>
              }
            >
              <div className="rm-table-view-label">{labels.density}</div>
              <div className="rm-segmented rm-table-density">
                <Button
                  aria-pressed={density === "comfortable"}
                  className={`rm-segmented-item ${density === "comfortable" ? "active" : ""}`}
                  onClick={() => setDensity("comfortable")}
                  size="sm"
                  variant="ghost"
                >
                  {labels.comfortable}
                </Button>
                <Button
                  aria-pressed={density === "compact"}
                  className={`rm-segmented-item ${density === "compact" ? "active" : ""}`}
                  onClick={() => setDensity("compact")}
                  size="sm"
                  variant="ghost"
                >
                  {labels.compact}
                </Button>
              </div>
              <div className="rm-table-view-label">{labels.columns}</div>
              {hideableColumns.map((c) => (
                <label className="rm-table-view-col" key={c.id}>
                  <Checkbox
                    checked={c.getIsVisible()}
                    onCheckedChange={(checked) =>
                      c.toggleVisibility(checked === true)
                    }
                  />
                  <span>{c.columnDef.header as string}</span>
                </label>
              ))}
            </Popover>
          </div>
        </div>
      ) : null}

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
        <div className="rm-table-pager">
          <span className="rm-table-pager-info">
            {formatNumber(table.getState().pagination.pageIndex * pageSize + 1)}
            –
            {formatNumber(
              Math.min(
                (table.getState().pagination.pageIndex + 1) * pageSize,
                table.getFilteredRowModel().rows.length,
              ),
            )}{" "}
            {labels.of} {formatNumber(table.getFilteredRowModel().rows.length)}
          </span>
          <div className="rm-table-pager-nav">
            <IconButton
              aria-label={labels.previousPage}
              className="rm-icon-button"
              disabled={!table.getCanPreviousPage()}
              onClick={() => table.previousPage()}
              variant="ghost"
            >
              <ChevronLeft aria-hidden size={16} />
            </IconButton>
            <IconButton
              aria-label={labels.nextPage}
              className="rm-icon-button"
              disabled={!table.getCanNextPage()}
              onClick={() => table.nextPage()}
              variant="ghost"
            >
              <ChevronRight aria-hidden size={16} />
            </IconButton>
          </div>
        </div>
      ) : null}

      {serverPagination ? (
        <div className="rm-table-pager">
          <span className="rm-table-pager-info">
            {serverPagination.isFetching ? (
              labels.loading
            ) : (
              <>
                {formatNumber(data.length)} {labels.shown}
              </>
            )}
          </span>
          <div className="rm-table-pager-nav">
            <IconButton
              aria-label={labels.previousPage}
              className="rm-icon-button"
              disabled={
                !serverPagination.onPrevPage || serverPagination.isFetching
              }
              onClick={() => serverPagination.onPrevPage?.()}
              variant="ghost"
            >
              <ChevronLeft aria-hidden size={16} />
            </IconButton>
            <IconButton
              aria-label={labels.nextPage}
              className="rm-icon-button"
              disabled={
                !serverPagination.hasNextPage || serverPagination.isFetching
              }
              onClick={() => serverPagination.onNextPage()}
              variant="ghost"
            >
              <ChevronRight aria-hidden size={16} />
            </IconButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}

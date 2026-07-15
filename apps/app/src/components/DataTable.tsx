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
import ArrowDown from "lucide-react/dist/esm/icons/arrow-down.mjs";
import ArrowUp from "lucide-react/dist/esm/icons/arrow-up.mjs";
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left.mjs";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right.mjs";
import ChevronsUpDown from "lucide-react/dist/esm/icons/chevrons-up-down.mjs";
import Search from "lucide-react/dist/esm/icons/search.mjs";
import SlidersHorizontal from "lucide-react/dist/esm/icons/sliders-horizontal.mjs";
import { useEffect, useRef, useState } from "react";

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
  empty = "No records",
  maxBodyHeight,
  pageSize = 25,
  serverPagination,
  enableRowSelection = false,
  bulkActions,
  getRowId,
}: {
  columns: ColumnDef<T, any>[];
  data: T[];
  empty?: string;
  maxBodyHeight?: number;
  pageSize?: number;
  serverPagination?: ServerPagination;
  enableRowSelection?: boolean;
  bulkActions?: (
    selectedIds: string[],
    clearSelection: () => void,
  ) => React.ReactNode;
  getRowId?: (row: T, index: number) => string;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [columnVisibility, setColumnVisibility] = useState<
    Record<string, boolean>
  >({});
  const [density, setDensity] = useState<"comfortable" | "compact">(
    "comfortable",
  );
  const [viewOpen, setViewOpen] = useState(false);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const virtualize = maxBodyHeight !== undefined;
  // Server pagination is authoritative: the parent owns page state, so the
  // internal client paginator must be off.
  const clientPaginate = !virtualize && !serverPagination;

  useEffect(() => {
    if (!viewOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!viewRef.current?.contains(e.target as Node)) setViewOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [viewOpen]);

  const selectionColumn: ColumnDef<T, any> = {
    id: "__select__",
    enableSorting: false,
    enableHiding: false,
    size: 36,
    header: ({ table }) => (
      <input
        aria-label="Select all rows"
        checked={table.getIsAllRowsSelected()}
        className="rm-table-select"
        onChange={table.getToggleAllRowsSelectedHandler()}
        ref={(el) => {
          if (el) el.indeterminate = table.getIsSomeRowsSelected();
        }}
        type="checkbox"
      />
    ),
    cell: ({ row }) => (
      <input
        aria-label="Select row"
        checked={row.getIsSelected()}
        className="rm-table-select"
        disabled={!row.getCanSelect()}
        onChange={row.getToggleSelectedHandler()}
        type="checkbox"
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
    <div className="rm-table-block">
      {showSearch ? (
        <div className="rm-table-toolbar">
          <div className="rm-table-search">
            <Search aria-hidden size={14} />
            <input
              aria-label="Search table"
              onChange={(e) => table.setGlobalFilter(e.currentTarget.value)}
              placeholder="Search…"
              value={globalFilter}
            />
          </div>
          <div className="rm-table-view" ref={viewRef}>
            <button
              aria-label="Table options"
              className="rm-icon-button rm-table-view-btn"
              onClick={() => setViewOpen((o) => !o)}
              type="button"
            >
              <SlidersHorizontal aria-hidden size={15} />
            </button>
            {viewOpen ? (
              <div className="rm-table-view-menu">
                <div className="rm-table-view-label">Density</div>
                <div className="rm-segmented rm-table-density">
                  <button
                    aria-pressed={density === "comfortable"}
                    className={`rm-segmented-item ${density === "comfortable" ? "active" : ""}`}
                    onClick={() => setDensity("comfortable")}
                    type="button"
                  >
                    Comfortable
                  </button>
                  <button
                    aria-pressed={density === "compact"}
                    className={`rm-segmented-item ${density === "compact" ? "active" : ""}`}
                    onClick={() => setDensity("compact")}
                    type="button"
                  >
                    Compact
                  </button>
                </div>
                <div className="rm-table-view-label">Columns</div>
                {hideableColumns.map((c) => (
                  <label className="rm-table-view-col" key={c.id}>
                    <input
                      checked={c.getIsVisible()}
                      onChange={c.getToggleVisibilityHandler()}
                      type="checkbox"
                    />
                    <span>{c.columnDef.header as string}</span>
                  </label>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {showBulkToolbar ? (
        <div className="rm-table-bulk" role="toolbar">
          <span className="rm-table-bulk-count">
            {selectedIds.length} selected
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
          virtualize ? { maxHeight: maxBodyHeight, overflowY: "auto" } : undefined
        }
      >
        <table className="rm-table">
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
                        <button
                          className="rm-th-sort-btn"
                          onClick={toggleSort}
                          type="button"
                        >
                          {inner}
                        </button>
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
                <td className="rm-table-empty" colSpan={table.getVisibleLeafColumns().length}>
                  {globalFilter ? "No matches" : empty}
                </td>
              </tr>
            ) : virtualize ? (
              <>
                {padTop > 0 ? (
                  <tr>
                    <td colSpan={table.getVisibleLeafColumns().length} style={{ height: padTop }} />
                  </tr>
                ) : null}
                {virtualItems.map((vi) => {
                  const row = rows[vi.index];
                  return row ? renderRow(row) : null;
                })}
                {padBottom > 0 ? (
                  <tr>
                    <td colSpan={table.getVisibleLeafColumns().length} style={{ height: padBottom }} />
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
            {table.getState().pagination.pageIndex * pageSize + 1}–
            {Math.min(
              (table.getState().pagination.pageIndex + 1) * pageSize,
              table.getFilteredRowModel().rows.length,
            )}{" "}
            of {table.getFilteredRowModel().rows.length}
          </span>
          <div className="rm-table-pager-nav">
            <button
              aria-label="Previous page"
              className="rm-icon-button"
              disabled={!table.getCanPreviousPage()}
              onClick={() => table.previousPage()}
              type="button"
            >
              <ChevronLeft aria-hidden size={16} />
            </button>
            <button
              aria-label="Next page"
              className="rm-icon-button"
              disabled={!table.getCanNextPage()}
              onClick={() => table.nextPage()}
              type="button"
            >
              <ChevronRight aria-hidden size={16} />
            </button>
          </div>
        </div>
      ) : null}

      {serverPagination ? (
        <div className="rm-table-pager">
          <span className="rm-table-pager-info">
            {serverPagination.isFetching ? "Loading…" : `${data.length} shown`}
          </span>
          <div className="rm-table-pager-nav">
            <button
              aria-label="Previous page"
              className="rm-icon-button"
              disabled={
                !serverPagination.onPrevPage || serverPagination.isFetching
              }
              onClick={() => serverPagination.onPrevPage?.()}
              type="button"
            >
              <ChevronLeft aria-hidden size={16} />
            </button>
            <button
              aria-label="Next page"
              className="rm-icon-button"
              disabled={
                !serverPagination.hasNextPage || serverPagination.isFetching
              }
              onClick={() => serverPagination.onNextPage()}
              type="button"
            >
              <ChevronRight aria-hidden size={16} />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

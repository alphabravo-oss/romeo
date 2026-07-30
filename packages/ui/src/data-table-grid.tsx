import { flexRender, type Row, type Table } from "@tanstack/react-table";
import type { VirtualItem } from "@tanstack/react-virtual";
import ArrowDown from "lucide-react/dist/esm/icons/arrow-down.mjs";
import ArrowUp from "lucide-react/dist/esm/icons/arrow-up.mjs";
import ChevronsUpDown from "lucide-react/dist/esm/icons/chevrons-up-down.mjs";
import type { RefObject } from "react";

import { Button } from "./button";

export function DataTableGrid<T>({
  density,
  empty,
  globalFilter,
  maxBodyHeight,
  minTableWidth,
  noMatches,
  onRowActivate,
  padBottom,
  padTop,
  rowAriaLabel,
  rows,
  scrollRef,
  table,
  virtualItems,
  virtualize,
}: {
  density: "comfortable" | "compact";
  empty: string;
  globalFilter: string;
  maxBodyHeight: number | undefined;
  minTableWidth: number | undefined;
  noMatches: string;
  onRowActivate: ((row: T) => void) | undefined;
  padBottom: number;
  padTop: number;
  rowAriaLabel: ((row: T) => string) | undefined;
  rows: Row<T>[];
  scrollRef: RefObject<HTMLDivElement | null>;
  table: Table<T>;
  virtualItems: VirtualItem[];
  virtualize: boolean;
}) {
  const renderRow = (row: Row<T>) => (
    <tr
      aria-label={onRowActivate ? rowAriaLabel?.(row.original) : undefined}
      className={onRowActivate ? "rm-table-row-action" : undefined}
      key={row.id}
      onClick={
        onRowActivate
          ? (event) => {
              if (isInteractiveTarget(event.target)) return;
              onRowActivate(row.original);
            }
          : undefined
      }
      onKeyDown={
        onRowActivate
          ? (event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              if (isInteractiveTarget(event.target)) return;
              event.preventDefault();
              onRowActivate(row.original);
            }
          : undefined
      }
      role={onRowActivate ? "link" : undefined}
      tabIndex={onRowActivate ? 0 : undefined}
    >
      {row.getVisibleCells().map((cell) => (
        <td key={cell.id}>
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </td>
      ))}
    </tr>
  );

  return (
    <div
      className={`rm-table-wrap ${density === "compact" ? "compact" : ""}`}
      ref={scrollRef}
      style={
        virtualize ? { maxHeight: maxBodyHeight, overflowY: "auto" } : undefined
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
                        onClick={header.column.getToggleSortingHandler()}
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
                {globalFilter ? noMatches : empty}
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
              {virtualItems.map((item) => {
                const row = rows[item.index];
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
  );
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(
      "a,button,input,select,textarea,[role='button'],[role='checkbox'],[role='menuitem']",
    ) !== null
  );
}

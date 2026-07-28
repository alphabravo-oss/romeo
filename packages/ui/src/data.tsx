import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type RowData,
} from "@tanstack/react-table";
import { type ReactNode } from "react";
import { Button } from "./button";
import { cn } from "./lib/cn";

export function BasicDataTable<TData extends RowData>({
  columns,
  data,
  empty,
  getRowId,
  onRowClick,
}: {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  empty?: ReactNode;
  getRowId?: (row: TData) => string;
  onRowClick?: (row: TData) => void;
}) {
  const table = useReactTable({
    columns,
    data,
    getCoreRowModel: getCoreRowModel(),
    ...(getRowId ? { getRowId } : {}),
  });
  if (data.length === 0 && empty) return <>{empty}</>;
  return (
    <div className="rm-ui-table-frame">
      <table className="rm-ui-table">
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => (
                <th colSpan={header.colSpan} key={header.id} scope="col">
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              className={cn(onRowClick && "rm-ui-table__row--interactive")}
              key={row.id}
              onClick={onRowClick ? () => onRowClick(row.original) : undefined}
            >
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Pagination({
  label,
  nextLabel,
  nextDisabled,
  onNext,
  onPrevious,
  paginationLabel,
  previousLabel,
  previousDisabled,
}: {
  label: ReactNode;
  nextLabel: ReactNode;
  nextDisabled?: boolean;
  onNext: () => void;
  onPrevious: () => void;
  paginationLabel: string;
  previousLabel: ReactNode;
  previousDisabled?: boolean;
}) {
  return (
    <nav aria-label={paginationLabel} className="rm-ui-pagination">
      <Button disabled={previousDisabled} onClick={onPrevious} size="sm">
        {previousLabel}
      </Button>
      <span aria-live="polite">{label}</span>
      <Button disabled={nextDisabled} onClick={onNext} size="sm">
        {nextLabel}
      </Button>
    </nav>
  );
}

export function ScrollArea({
  children,
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root>) {
  return (
    <ScrollAreaPrimitive.Root
      className={cn("rm-ui-scroll-area", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport className="rm-ui-scroll-area__viewport">
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar
        className="rm-ui-scroll-area__scrollbar"
        orientation="vertical"
      >
        <ScrollAreaPrimitive.Thumb className="rm-ui-scroll-area__thumb" />
      </ScrollAreaPrimitive.Scrollbar>
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

export type { ColumnDef } from "@tanstack/react-table";

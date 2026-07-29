import type { Table } from "@tanstack/react-table";
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left.mjs";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right.mjs";
import type { ReactNode } from "react";

import type { DataTableLabels, ServerPagination } from "./advanced-data-table";
import { IconButton } from "./button";

export function ClientTablePager<T>({
  formatNumber,
  labels,
  table,
}: {
  formatNumber: (value: number) => ReactNode;
  labels: DataTableLabels;
  table: Table<T>;
}) {
  const { pageIndex, pageSize } = table.getState().pagination;
  return (
    <div className="rm-table-pager">
      <span className="rm-table-pager-info">
        {formatNumber(pageIndex * pageSize + 1)}–
        {formatNumber(
          Math.min(
            (pageIndex + 1) * pageSize,
            table.getFilteredRowModel().rows.length,
          ),
        )}{" "}
        {labels.of} {formatNumber(table.getFilteredRowModel().rows.length)}
      </span>
      <PagerButtons
        canNext={table.getCanNextPage()}
        canPrevious={table.getCanPreviousPage()}
        labels={labels}
        onNext={() => table.nextPage()}
        onPrevious={() => table.previousPage()}
      />
    </div>
  );
}

export function ServerTablePager({
  dataLength,
  formatNumber,
  labels,
  pagination,
}: {
  dataLength: number;
  formatNumber: (value: number) => ReactNode;
  labels: DataTableLabels;
  pagination: ServerPagination;
}) {
  return (
    <div className="rm-table-pager">
      <span className="rm-table-pager-info">
        {pagination.isFetching ? (
          labels.loading
        ) : (
          <>
            {formatNumber(dataLength)} {labels.shown}
          </>
        )}
      </span>
      <PagerButtons
        canNext={pagination.hasNextPage && !pagination.isFetching}
        canPrevious={
          pagination.onPrevPage !== undefined && !pagination.isFetching
        }
        labels={labels}
        onNext={pagination.onNextPage}
        onPrevious={() => pagination.onPrevPage?.()}
      />
    </div>
  );
}

function PagerButtons({
  canNext,
  canPrevious,
  labels,
  onNext,
  onPrevious,
}: {
  canNext: boolean;
  canPrevious: boolean;
  labels: DataTableLabels;
  onNext: () => void;
  onPrevious: () => void;
}) {
  return (
    <div className="rm-table-pager-nav">
      <IconButton
        aria-label={labels.previousPage}
        className="rm-icon-button"
        disabled={!canPrevious}
        onClick={onPrevious}
        variant="ghost"
      >
        <ChevronLeft aria-hidden size={16} />
      </IconButton>
      <IconButton
        aria-label={labels.nextPage}
        className="rm-icon-button"
        disabled={!canNext}
        onClick={onNext}
        variant="ghost"
      >
        <ChevronRight aria-hidden size={16} />
      </IconButton>
    </div>
  );
}

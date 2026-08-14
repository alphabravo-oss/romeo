import type { Table } from "@tanstack/react-table";
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left.mjs";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right.mjs";
import type { ReactNode } from "react";

import type { DataTableLabels } from "./advanced-data-table";
import type { ServerPagination } from "./server-table-state";

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
            {pagination.pageIndex === undefined ? null : (
              <>
                {labels.page} {formatNumber(pagination.pageIndex + 1)} ·{" "}
              </>
            )}
            {formatNumber(dataLength)} {labels.shown}
            {pagination.total?.mode === "unknown" ||
            pagination.total === undefined ? null : (
              <>
                {" · "}
                {pagination.total.mode === "estimated" ? "~" : ""}
                {formatNumber(pagination.total.value)} {labels.total}
              </>
            )}
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

/**
 * Labelled page controls. Bare chevrons made people guess which arrow paged
 * which way and gave a 28px hit target; the words are the affordance.
 */
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
      <button
        className="rm-table-pager-button"
        disabled={!canPrevious}
        onClick={onPrevious}
        type="button"
      >
        <ChevronLeft aria-hidden size={14} />
        {labels.previousPage}
      </button>
      <button
        className="rm-table-pager-button"
        disabled={!canNext}
        onClick={onNext}
        type="button"
      >
        {labels.nextPage}
        <ChevronRight aria-hidden size={14} />
      </button>
    </div>
  );
}

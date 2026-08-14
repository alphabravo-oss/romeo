import { useCallback, useState } from "react";

import type { ServerTableState } from "./DataTable";

export const DEFAULT_WEBHOOK_DELIVERY_PAGE_SIZE = 25;
const deliverySorting = [{ id: "createdAt", desc: true }] as const;

export function useWebhookDeliveryPager() {
  const [cursors, setCursors] = useState<Array<string | undefined>>([
    undefined,
  ]);
  const [pageSize, setPageSize] = useState(DEFAULT_WEBHOOK_DELIVERY_PAGE_SIZE);
  const reset = useCallback(() => setCursors([undefined]), []);
  const tableState = useCallback(
    (input: {
      isFetching: boolean;
      nextCursor?: string;
      webhookId?: string;
    }): ServerTableState => ({
      filters:
        input.webhookId === undefined
          ? []
          : [
              {
                field: "webhookId",
                operator: "eq",
                value: input.webhookId,
              },
            ],
      hasNextPage: input.nextCursor !== undefined,
      isFetching: input.isFetching,
      onNextPage: () => {
        if (input.nextCursor !== undefined)
          setCursors((current) =>
            current[current.length - 1] === input.nextCursor
              ? current
              : [...current, input.nextCursor],
          );
      },
      onPageSizeChange: (nextPageSize) => {
        setPageSize(nextPageSize);
        setCursors([undefined]);
      },
      ...(cursors.length > 1
        ? {
            onPreviousPage: () => setCursors((current) => current.slice(0, -1)),
          }
        : {}),
      pageIndex: cursors.length - 1,
      pageSize,
      search: "",
      sorting: [...deliverySorting],
      total: { mode: "unknown" },
    }),
    [cursors.length, pageSize],
  );

  return {
    cursor: cursors[cursors.length - 1],
    isFirstPage: cursors.length === 1,
    pageSize,
    reset,
    tableState,
  };
}

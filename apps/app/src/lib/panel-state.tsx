import { Button, EmptyState, InlineError, Skeleton } from "@romeo/ui";
import type { UseQueryResult } from "@tanstack/react-query";

import { useLocale } from "./i18n";

/**
 * Renders the loading / error / empty / data states of a TanStack Query
 * result uniformly, so the 12 consumer panels don't each re-implement the
 * same `isPending` / `isError` / empty-check ladder.
 *
 *   const query = useQuery({ queryKey: ['users'], queryFn: listUsers })
 *   <PanelState query={query} empty="No users yet.">
 *     {(users) => <DataTable columns={columns} data={users} />}
 *   </PanelState>
 *
 * - `query.isPending` → a small shimmer skeleton (existing `rm-skeleton`).
 * - `query.isError` → an `rm-composer-error` box with the message + Retry.
 * - empty (`isEmpty(data)`) → `<div className="rm-empty">{empty}</div>`.
 * - otherwise → `children(data)`.
 */
export function PanelState<T>(props: {
  query: UseQueryResult<T>;
  empty?: string;
  /** Optional CTA (e.g. a "+ Add X" button) shown under the empty message. */
  emptyAction?: React.ReactNode;
  isEmpty?: (data: T) => boolean;
  children: (data: T) => React.ReactNode;
}): React.ReactNode {
  const { t } = useLocale();
  const {
    query,
    empty = t("nothingHereYet"),
    emptyAction,
    isEmpty,
    children,
  } = props;

  if (query.isPending) {
    return (
      <div
        aria-busy="true"
        aria-label={t("dataLoading")}
        className="grid gap-2 p-4"
        role="status"
      >
        <Skeleton className="w-2/3" />
        <Skeleton className="w-1/2" />
        <Skeleton className="w-3/5" />
      </div>
    );
  }

  if (query.isError && query.data === undefined) {
    return (
      <InlineError className="flex flex-wrap items-center gap-2" role="alert">
        <span>{t("queryCouldNotLoad")}</span>
        <Button
          onClick={() => void query.refetch()}
          size="sm"
          type="button"
          variant="outline"
        >
          {t("tryAgain")}
        </Button>
      </InlineError>
    );
  }

  const data = query.data;
  if (data === undefined) {
    return <EmptyState action={emptyAction} title={empty} />;
  }
  const emptyCheck =
    isEmpty ?? ((value: T) => Array.isArray(value) && value.length === 0);
  if (emptyCheck(data)) {
    return <EmptyState action={emptyAction} title={empty} />;
  }

  return children(data);
}

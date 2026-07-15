import type { UseQueryResult } from "@tanstack/react-query";

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
  const { query, empty = "Nothing here yet.", emptyAction, isEmpty, children } = props;

  if (query.isPending) {
    return (
      <div className="grid gap-2 p-4" aria-busy="true">
        <span className="rm-skeleton" style={{ width: "70%" }} />
        <span className="rm-skeleton" style={{ width: "45%" }} />
        <span className="rm-skeleton" style={{ width: "58%" }} />
      </div>
    );
  }

  if (query.isError) {
    const message =
      query.error instanceof Error
        ? query.error.message
        : String(query.error);
    return (
      <div className="rm-composer-error" role="alert">
        <span>{message}</span>
        <button
          className="rm-button"
          onClick={() => void query.refetch()}
          style={{ marginLeft: 8 }}
          type="button"
        >
          Retry
        </button>
      </div>
    );
  }

  const data = query.data;
  const emptyCheck =
    isEmpty ?? ((value: T) => Array.isArray(value) && value.length === 0);
  if (emptyCheck(data)) {
    if (emptyAction === undefined) {
      return <div className="rm-empty">{empty}</div>;
    }
    return (
      <div className="rm-empty-state">
        <p className="rm-empty-state-text">{empty}</p>
        {emptyAction}
      </div>
    );
  }

  return children(data);
}

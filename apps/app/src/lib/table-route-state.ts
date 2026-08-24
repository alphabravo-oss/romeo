export interface TableRouteState {
  direction: "asc" | "desc";
  filters: Record<string, string>;
  page: number;
  pageSize: number;
  query: string;
  savedViewId?: string;
  sort: string;
  view?: string;
}

export interface TableRoutePolicy {
  defaultPageSize: number;
  defaultSort: string;
  filterKeys: readonly string[];
  pageSizes: readonly number[];
  sorts: readonly string[];
  views?: readonly string[];
}

export type TableRoutePatch = Partial<
  Omit<TableRouteState, "filters"> & { filters: Record<string, string> }
>;

interface CompactTableRouteState {
  d?: unknown;
  f?: unknown;
  p?: unknown;
  q?: unknown;
  s?: unknown;
  v?: unknown;
  w?: unknown;
  z?: unknown;
}

interface NormalizableTableRouteState {
  direction?: unknown;
  filters?: unknown;
  page?: unknown;
  pageSize?: unknown;
  query?: unknown;
  savedViewId?: unknown;
  sort?: unknown;
  view?: unknown;
}

const MAX_ROUTE_STATE_LENGTH = 2_048;
const MAX_QUERY_LENGTH = 256;
const MAX_FILTER_VALUE_LENGTH = 128;

export function defaultTableRouteState(
  policy: TableRoutePolicy,
): TableRouteState {
  return {
    direction: "asc",
    filters: {},
    page: 0,
    pageSize: policy.defaultPageSize,
    query: "",
    sort: policy.defaultSort,
  };
}

export function parseTableRouteState(
  encoded: string | undefined,
  policy: TableRoutePolicy,
): TableRouteState {
  const fallback = defaultTableRouteState(policy);
  if (!encoded || encoded.length > MAX_ROUTE_STATE_LENGTH) return fallback;
  try {
    const compact = JSON.parse(encoded) as CompactTableRouteState;
    if (!isRecord(compact)) return fallback;
    return normalizeTableRouteState(
      {
        direction: compact.d,
        filters: compact.f,
        page: compact.p,
        pageSize: compact.z,
        query: compact.q,
        savedViewId: compact.w,
        sort: compact.s,
        view: compact.v,
      },
      policy,
    );
  } catch {
    return fallback;
  }
}

export function serializeTableRouteState(
  state: TableRouteState,
  policy: TableRoutePolicy,
): string {
  const normalized = normalizeTableRouteState(state, policy);
  const compact: CompactTableRouteState = {
    ...(normalized.query ? { q: normalized.query } : {}),
    ...(normalized.sort !== policy.defaultSort ? { s: normalized.sort } : {}),
    ...(normalized.direction === "desc" ? { d: "desc" } : {}),
    ...(Object.keys(normalized.filters).length > 0
      ? { f: normalized.filters }
      : {}),
    ...(normalized.page > 0 ? { p: normalized.page } : {}),
    ...(normalized.pageSize !== policy.defaultPageSize
      ? { z: normalized.pageSize }
      : {}),
    ...(normalized.view ? { v: normalized.view } : {}),
    ...(normalized.savedViewId ? { w: normalized.savedViewId } : {}),
  };
  return JSON.stringify(compact);
}

export function updateTableRouteState(
  current: TableRouteState,
  patch: TableRoutePatch,
  policy: TableRoutePolicy,
): TableRouteState {
  const next = normalizeTableRouteState({ ...current, ...patch }, policy);
  if (patch.page !== undefined) return next;
  return changesResultSet(current, next) ? { ...next, page: 0 } : next;
}

export function applySavedTableView(
  current: TableRouteState,
  savedView: Pick<
    TableRouteState,
    "direction" | "filters" | "pageSize" | "query" | "sort" | "view"
  >,
  savedViewId: string,
  policy: TableRoutePolicy,
): TableRouteState {
  return updateTableRouteState(
    current,
    { ...savedView, page: 0, savedViewId },
    policy,
  );
}

export function resetTableRouteScope(
  current: TableRouteState,
): TableRouteState {
  const { savedViewId: _savedViewId, ...withoutSavedView } = current;
  return { ...withoutSavedView, page: 0 };
}

function normalizeTableRouteState(
  value: NormalizableTableRouteState,
  policy: TableRoutePolicy,
): TableRouteState {
  const fallback = defaultTableRouteState(policy);
  const query =
    typeof value.query === "string"
      ? value.query.slice(0, MAX_QUERY_LENGTH)
      : "";
  const filters = normalizeFilters(value.filters, policy.filterKeys);
  const sort =
    typeof value.sort === "string" && policy.sorts.includes(value.sort)
      ? value.sort
      : policy.defaultSort;
  const pageSize =
    typeof value.pageSize === "number" &&
    policy.pageSizes.includes(value.pageSize)
      ? value.pageSize
      : policy.defaultPageSize;
  const page =
    typeof value.page === "number" && Number.isSafeInteger(value.page)
      ? Math.max(0, Math.min(value.page, 10_000))
      : 0;
  const view =
    typeof value.view === "string" && policy.views?.includes(value.view)
      ? value.view
      : undefined;
  const savedViewId =
    typeof value.savedViewId === "string" &&
    value.savedViewId.length > 0 &&
    value.savedViewId.length <= 128
      ? value.savedViewId
      : undefined;
  return {
    ...fallback,
    direction: value.direction === "desc" ? "desc" : "asc",
    filters,
    page,
    pageSize,
    query,
    sort,
    ...(view ? { view } : {}),
    ...(savedViewId ? { savedViewId } : {}),
  };
}

function normalizeFilters(
  value: unknown,
  filterKeys: readonly string[],
): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    filterKeys.flatMap((key) => {
      const filter = value[key];
      return typeof filter === "string" &&
        filter.length <= MAX_FILTER_VALUE_LENGTH
        ? [[key, filter]]
        : [];
    }),
  );
}

function changesResultSet(
  current: TableRouteState,
  next: TableRouteState,
): boolean {
  return (
    current.query !== next.query ||
    current.sort !== next.sort ||
    current.direction !== next.direction ||
    current.pageSize !== next.pageSize ||
    current.view !== next.view ||
    current.savedViewId !== next.savedViewId ||
    JSON.stringify(current.filters) !== JSON.stringify(next.filters)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

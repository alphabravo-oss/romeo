import type { ServerTableState } from "@romeo/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import {
  inventoriedTablePageQueryOptions,
  type InventoriedTablePageQuery,
} from "./inventoried-table-page-query";
import {
  type InventoriedTableResourceFilter,
  type InventoriedTableResourceName,
  type InventoriedTableResourceRegistry,
  type InventoriedTableResourceRow,
  tableResourceDefinition,
} from "./inventoried-table-resource-registry";

type TableSort = { desc: boolean; id: string };
type ScopeFor<Resource extends InventoriedTableResourceName> =
  InventoriedTableResourceRegistry[Resource]["scope"];

interface BaseOptions<Resource extends InventoriedTableResourceName> {
  enabled?: boolean;
  filters?: Array<InventoriedTableResourceFilter<Resource>>;
  pageSize?: number;
  refetchInterval?: (
    rows: Array<InventoriedTableResourceRow<Resource>> | undefined,
  ) => number | false;
}

type DisabledScope = { enabled: false; parentId?: never; workspaceId?: never };
export type InventoriedServerTableOptions<
  Resource extends InventoriedTableResourceName,
> = BaseOptions<Resource> &
  (ScopeFor<Resource> extends "parent"
    ? { parentId: string; workspaceId?: never } | DisabledScope
    : ScopeFor<Resource> extends "workspace"
      ? { parentId?: never; workspaceId: string } | DisabledScope
      : { parentId?: never; workspaceId?: never });

type InventoriedServerTableArguments<
  Resource extends InventoriedTableResourceName,
> =
  ScopeFor<Resource> extends "organization"
    ? [options?: InventoriedServerTableOptions<Resource>]
    : [options: InventoriedServerTableOptions<Resource>];

export function useInventoriedServerTable<
  Resource extends InventoriedTableResourceName,
>(resource: Resource, ...args: InventoriedServerTableArguments<Resource>) {
  const options = (args[0] ?? {}) as InventoriedServerTableOptions<Resource>;
  const definition = tableResourceDefinition(resource);
  const [pageSize, setPageSize] = useState(options.pageSize ?? 25);
  const [search, setSearch] = useState("");
  const [sorting, setSorting] = useState<TableSort[]>([]);
  const [savedViewFilters, setSavedViewFilters] = useState<
    Array<InventoriedTableResourceFilter<Resource>> | undefined
  >();
  const normalizedFilters = useMemo(
    () => normalizeFilters(savedViewFilters ?? options.filters ?? []),
    [options.filters, savedViewFilters],
  );
  const parentId = "parentId" in options ? options.parentId : undefined;
  const workspaceId =
    "workspaceId" in options ? options.workspaceId : undefined;
  const scopeKey = useMemo(
    () => tableScopeKey(resource, parentId, workspaceId, normalizedFilters),
    [normalizedFilters, parentId, resource, workspaceId],
  );
  const [cursorState, setCursorState] = useState(() => ({
    cursors: [] as string[],
    scopeKey,
  }));
  const scopeMatches = cursorState.scopeKey === scopeKey;
  const cursors = useMemo(
    () => (scopeMatches ? cursorState.cursors : []),
    [cursorState.cursors, scopeMatches],
  );

  useEffect(() => {
    setSavedViewFilters(undefined);
  }, [parentId, resource, workspaceId]);

  useEffect(() => {
    setCursorState((current) =>
      current.scopeKey === scopeKey ? current : { cursors: [], scopeKey },
    );
  }, [scopeKey]);

  const apiSort = useMemo(
    () =>
      sorting.flatMap((sort) => {
        const field = (
          definition.sortFieldByColumnId as Record<string, string>
        )[sort.id];
        return field === undefined
          ? []
          : [
              {
                direction: sort.desc ? ("desc" as const) : ("asc" as const),
                field,
              },
            ];
      }) as InventoriedTablePageQuery<Resource>["sort"],
    [definition.sortFieldByColumnId, sorting],
  );
  const trimmedSearch = search.trim();
  const continuityKey = useMemo(
    () =>
      tableDataContinuityKey(
        scopeKey,
        pageSize,
        trimmedSearch,
        apiSort as Array<{ direction: "asc" | "desc"; field: string }>,
      ),
    [apiSort, pageSize, scopeKey, trimmedSearch],
  );
  const request = useMemo((): InventoriedTablePageQuery<Resource> => {
    const cursor = cursors.at(-1);
    return {
      filters: normalizedFilters,
      limit: pageSize,
      resource,
      sort: apiSort,
      ...(cursor === undefined ? {} : { cursor }),
      ...(parentId === undefined ? {} : { parentId }),
      ...(trimmedSearch === "" ? {} : { search: trimmedSearch }),
      ...(workspaceId === undefined ? {} : { workspaceId }),
    };
  }, [
    apiSort,
    cursors,
    normalizedFilters,
    pageSize,
    parentId,
    resource,
    trimmedSearch,
    workspaceId,
  ]);
  const query = useQuery(
    inventoriedTablePageQueryOptions<Resource>(request, {
      continuityKey,
      enabled: options.enabled !== false && scopeMatches,
      ...(options.refetchInterval === undefined
        ? {}
        : { refetchInterval: options.refetchInterval }),
    }),
  );
  const rows = query.data?.items ?? [];
  const serverState = useMemo((): ServerTableState => {
    const status =
      options.enabled === false
        ? "idle"
        : query.isError
          ? "error"
          : query.data === undefined
            ? "loading"
            : "success";
    const state: ServerTableState = {
      ...(options.enabled !== false &&
      (definition.capabilities.export || definition.capabilities.savedViews)
        ? {
            authorityScope: {
              resource,
              schemaVersion: 2,
              ...(parentId === undefined ? {} : { parentId }),
              ...(workspaceId === undefined ? {} : { workspaceId }),
            },
          }
        : {}),
      filters: query.data?.applied.filters ?? [],
      requestedFilters: normalizedFilters,
      hasNextPage: query.data?.page.nextCursor != null,
      isFetching: query.isFetching,
      isScopeTransition: !scopeMatches,
      onNextPage: () => {
        const next = query.data?.page.nextCursor;
        if (next != null) {
          setCursorState((current) =>
            current.scopeKey === scopeKey
              ? { ...current, cursors: [...current.cursors, next] }
              : { cursors: [next], scopeKey },
          );
        }
      },
      onFiltersChange: (filters) => {
        setSavedViewFilters(validSavedViewFilters(definition.filters, filters));
        setCursorState({ cursors: [], scopeKey });
      },
      onPageSizeChange: (next) => {
        setPageSize(next);
        setCursorState({ cursors: [], scopeKey });
      },
      onSearchChange: (updater) => {
        setSearch((current) =>
          typeof updater === "function" ? updater(current) : updater,
        );
        setCursorState({ cursors: [], scopeKey });
      },
      onSortingChange: (updater) => {
        setSorting((current) =>
          typeof updater === "function" ? updater(current) : updater,
        );
        setCursorState({ cursors: [], scopeKey });
      },
      pageIndex: cursors.length,
      pageSize,
      retry: () => void query.refetch(),
      scopeKey,
      search,
      sortFieldByColumnId: definition.sortFieldByColumnId,
      sorting,
      status,
      total:
        query.data === undefined
          ? { mode: "unknown" }
          : { mode: "estimated", value: query.data.page.estimatedTotal },
    };
    if (cursors.length > 0) {
      state.onPreviousPage = () =>
        setCursorState((current) => ({
          ...current,
          cursors: current.cursors.slice(0, -1),
        }));
    }
    return state;
  }, [
    cursors.length,
    definition.sortFieldByColumnId,
    definition.capabilities.export,
    definition.capabilities.savedViews,
    definition.filters,
    normalizedFilters,
    options.enabled,
    pageSize,
    parentId,
    query,
    resource,
    scopeKey,
    scopeMatches,
    search,
    sorting,
    workspaceId,
  ]);

  return {
    estimatedTotal: query.data?.page.estimatedTotal ?? 0,
    isFirstPage: cursors.length === 0,
    query,
    rows,
    search,
    serverState,
    summary: query.data?.summary ?? {},
  };
}

function validSavedViewFilters<Resource extends InventoriedTableResourceName>(
  policy: Readonly<Record<string, readonly string[]>>,
  filters: readonly { field: string; operator: string; value?: unknown }[],
): Array<InventoriedTableResourceFilter<Resource>> {
  return filters.filter((filter) =>
    policy[filter.field]?.includes(filter.operator),
  ) as Array<InventoriedTableResourceFilter<Resource>>;
}

export function tableScopeKey(
  resource: InventoriedTableResourceName,
  parentId: string | undefined,
  workspaceId: string | undefined,
  filters: readonly { field: string; operator: string; value?: unknown }[],
): string {
  return stableSerialize({
    filters: [...filters].sort((left, right) =>
      stableSerialize(left).localeCompare(stableSerialize(right)),
    ),
    parentId: parentId ?? null,
    resource,
    workspaceId: workspaceId ?? null,
  });
}

export function tableDataContinuityKey(
  scopeKey: string,
  pageSize: number,
  search: string,
  sort: readonly { direction: "asc" | "desc"; field: string }[],
): string {
  return stableSerialize({ pageSize, scopeKey, search, sort });
}

function normalizeFilters<Resource extends InventoriedTableResourceName>(
  filters: Array<InventoriedTableResourceFilter<Resource>>,
): Array<InventoriedTableResourceFilter<Resource>> {
  return [...filters].sort((left, right) =>
    stableSerialize(left).localeCompare(stableSerialize(right)),
  );
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => a.localeCompare(b),
    );
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

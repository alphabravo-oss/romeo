import { queryOptions } from "@tanstack/react-query";
import { tablePagesQuery } from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

import * as appQueryKeys from "./app-query-keys";
import {
  InventoriedTableContractError,
  type InventoriedTableResourceFilter,
  type InventoriedTableResourceName,
  type InventoriedTableResourceRow,
  type InventoriedTableResourceSortField,
  parseInventoriedTableResourceRow,
  tableResourceDefinition,
} from "./inventoried-table-resource-registry";
import { serverQueryPolicy } from "./server-query-options";

export interface InventoriedTablePageQuery<
  Resource extends InventoriedTableResourceName = InventoriedTableResourceName,
> {
  cursor?: string;
  filters: Array<InventoriedTableResourceFilter<Resource>>;
  limit: number;
  parentId?: string;
  resource: Resource;
  search?: string;
  sort: Array<{
    direction: "asc" | "desc";
    field: InventoriedTableResourceSortField<Resource>;
  }>;
  workspaceId?: string;
}

export interface InventoriedTablePage<
  Resource extends InventoriedTableResourceName,
> {
  applied: {
    filters: Array<InventoriedTableResourceFilter<Resource>>;
    sort: InventoriedTablePageQuery<Resource>["sort"];
  };
  items: Array<InventoriedTableResourceRow<Resource>>;
  page: {
    estimatedTotal: number;
    limit: number;
    nextCursor: string | null;
    previousCursor: string | null;
  };
  resource: Resource;
  summary?: Record<string, number>;
}

export async function queryInventoriedTablePage<
  Resource extends InventoriedTableResourceName,
>(
  request: InventoriedTablePageQuery<Resource>,
  signal?: AbortSignal,
): Promise<InventoriedTablePage<Resource>> {
  configureBrowserApiClients();
  const response = await tablePagesQuery({
    body: {
      resource: request.resource,
      limit: request.limit,
      sort: request.sort,
      filters: request.filters,
      ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
      ...(request.parentId === undefined ? {} : { parentId: request.parentId }),
      ...(request.search === undefined ? {} : { search: request.search }),
      ...(request.workspaceId === undefined
        ? {}
        : { workspaceId: request.workspaceId }),
    },
    ...(signal === undefined ? {} : { signal }),
    throwOnError: true,
  });
  return parseInventoriedTablePage(request, response.data.data);
}

/** Validates the generated client's unknown JSON at the application boundary. */
export function parseInventoriedTablePage<
  Resource extends InventoriedTableResourceName,
>(
  request: InventoriedTablePageQuery<Resource>,
  value: unknown,
): InventoriedTablePage<Resource> {
  const definition = tableResourceDefinition(request.resource);
  const data = requireRecord(request.resource, value, "response data");
  if (data.resource !== request.resource) {
    invalid(request.resource, "response resource does not match the request");
  }
  if (!Array.isArray(data.items))
    invalid(request.resource, "items must be an array");
  const page = requireRecord(request.resource, data.page, "page");
  const limit = requireInteger(request.resource, page.limit, "page.limit", 1);
  if (limit !== request.limit)
    invalid(request.resource, "page.limit does not match the request");
  const estimatedTotal = requireInteger(
    request.resource,
    page.estimatedTotal,
    "page.estimatedTotal",
    0,
  );
  const nextCursor = requireCursor(
    request.resource,
    page.nextCursor,
    "page.nextCursor",
  );
  const previousCursor = requireCursor(
    request.resource,
    page.previousCursor,
    "page.previousCursor",
  );
  if (data.items.length > limit)
    invalid(request.resource, "items exceed page.limit");

  const ids = new Set<string>();
  const items = data.items.map((item) => {
    const row = parseInventoriedTableResourceRow(request.resource, item);
    if (
      request.parentId !== undefined &&
      definition.parentIdentityField !== undefined &&
      (row as Record<string, unknown>)[definition.parentIdentityField] !==
        request.parentId
    ) {
      invalid(
        request.resource,
        `row ${row.id} does not belong to requested parent`,
      );
    }
    if (ids.has(row.id))
      invalid(request.resource, `duplicate row id: ${row.id}`);
    ids.add(row.id);
    return row;
  });

  const applied = requireRecord(request.resource, data.applied, "applied");
  const filters = parseFilters(
    request.resource,
    applied.filters,
    definition.filters,
  );
  const sort = parseSort(request.resource, applied.sort, definition.sortFields);
  const result: InventoriedTablePage<Resource> = {
    applied: { filters, sort },
    items,
    page: { estimatedTotal, limit, nextCursor, previousCursor },
    resource: request.resource,
  };
  if (data.summary !== undefined) {
    const summary = requireRecord(request.resource, data.summary, "summary");
    const allowed = new Set<string>(definition.summaryKeys);
    result.summary = Object.fromEntries(
      Object.entries(summary).map(([key, summaryValue]) => {
        if (!allowed.has(key))
          invalid(request.resource, `unsupported summary key: ${key}`);
        return [
          key,
          requireInteger(request.resource, summaryValue, `summary.${key}`, 0),
        ];
      }),
    );
  }
  return result;
}

export function inventoriedTablePageQueryOptions<
  Resource extends InventoriedTableResourceName,
>(
  request: InventoriedTablePageQuery<Resource>,
  options: {
    continuityKey: string;
    enabled: boolean;
    refetchInterval?: (
      rows: Array<InventoriedTableResourceRow<Resource>> | undefined,
    ) => number | false;
  },
) {
  return queryOptions<
    InventoriedTablePage<Resource>,
    Error,
    InventoriedTablePage<Resource>
  >({
    ...serverQueryPolicy(
      "interactive",
      "tablePages",
      { resource: request.resource },
      { tableContinuityKey: options.continuityKey },
    ),
    enabled: options.enabled,
    queryFn: ({ signal }) => queryInventoriedTablePage(request, signal),
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.meta?.tableContinuityKey === options.continuityKey
        ? previousData
        : undefined,
    queryKey: appQueryKeys.tablePages(request),
    ...(options.refetchInterval === undefined
      ? {}
      : {
          refetchInterval: (query) =>
            options.refetchInterval?.(query.state.data?.items) ?? false,
        }),
  });
}

function parseFilters<Resource extends InventoriedTableResourceName>(
  resource: Resource,
  value: unknown,
  policy: Readonly<Record<string, readonly string[]>>,
): Array<InventoriedTableResourceFilter<Resource>> {
  if (!Array.isArray(value))
    invalid(resource, "applied.filters must be an array");
  return value.map((entry, index) => {
    const filter = requireRecord(resource, entry, `applied.filters[${index}]`);
    if (typeof filter.field !== "string" || !(filter.field in policy)) {
      invalid(
        resource,
        `unsupported applied filter field: ${String(filter.field)}`,
      );
    }
    const operators = policy[filter.field];
    if (
      typeof filter.operator !== "string" ||
      !operators?.includes(filter.operator)
    ) {
      invalid(
        resource,
        `unsupported applied filter operator: ${String(filter.operator)}`,
      );
    }
    return {
      field: filter.field,
      operator: filter.operator,
      ...(filter.value === undefined ? {} : { value: filter.value }),
    } as InventoriedTableResourceFilter<Resource>;
  });
}

function parseSort<Resource extends InventoriedTableResourceName>(
  resource: Resource,
  value: unknown,
  fields: readonly string[],
): InventoriedTablePageQuery<Resource>["sort"] {
  if (!Array.isArray(value)) invalid(resource, "applied.sort must be an array");
  return value.map((entry, index) => {
    const sort = requireRecord(resource, entry, `applied.sort[${index}]`);
    if (typeof sort.field !== "string" || !fields.includes(sort.field)) {
      invalid(
        resource,
        `unsupported applied sort field: ${String(sort.field)}`,
      );
    }
    if (sort.direction !== "asc" && sort.direction !== "desc") {
      invalid(
        resource,
        `invalid applied sort direction: ${String(sort.direction)}`,
      );
    }
    return {
      direction: sort.direction,
      field: sort.field,
    } as InventoriedTablePageQuery<Resource>["sort"][number];
  });
}

function requireRecord(
  resource: InventoriedTableResourceName,
  value: unknown,
  field: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(resource, `${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireInteger(
  resource: InventoriedTableResourceName,
  value: unknown,
  field: string,
  minimum: number,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    invalid(
      resource,
      `${field} must be an integer greater than or equal to ${minimum}`,
    );
  }
  return value as number;
}

function requireCursor(
  resource: InventoriedTableResourceName,
  value: unknown,
  field: string,
): string | null {
  if (value !== null && (typeof value !== "string" || value.length === 0)) {
    invalid(resource, `${field} must be a non-empty string or null`);
  }
  return value as string | null;
}

function invalid(
  resource: InventoriedTableResourceName,
  message: string,
): never {
  throw new InventoriedTableContractError(resource, message);
}

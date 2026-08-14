import { ApiError } from "../errors";
import {
  InvalidPageCursorError,
  type PageCursorCodec,
} from "./page-cursor";

export const inventoriedTableMaxLimit = 100;

export interface InventoriedTableRow {
  id: string;
  [key: string]: unknown;
}

export interface InventoriedTableSort {
  field: string;
  direction: "asc" | "desc";
}

export interface InventoriedTableFilter {
  field: string;
  operator: string;
  value?: unknown;
}

export interface InventoriedTableQuery {
  cursor?: string;
  filters: InventoriedTableFilter[];
  limit: number;
  search?: string;
  sort: InventoriedTableSort[];
}

export interface InventoriedTablePolicy {
  defaultSort: InventoriedTableSort;
  filters: Readonly<Record<string, readonly string[]>>;
  maxLimit?: number;
  searchFields: readonly string[];
  sortFields: readonly [string, ...string[]];
}

export interface InventoriedTableTenant {
  orgId: string;
  parentId?: string;
  workspaceId?: string;
}

export interface InventoriedTablePageResult {
  applied: {
    filters: InventoriedTableFilter[];
    sort: InventoriedTableSort[];
  };
  items: InventoriedTableRow[];
  page: {
    estimatedTotal: number;
    limit: number;
    nextCursor: string | null;
    previousCursor: null;
  };
}

export function pageInventoriedTable(input: {
  codec: PageCursorCodec;
  policy: InventoriedTablePolicy;
  query: InventoriedTableQuery;
  rows: readonly InventoriedTableRow[];
  tenant: InventoriedTableTenant;
}): InventoriedTablePageResult {
  const normalized = normalizeInventoriedTableQuery(input.query, input.policy);
  const cursorContext = {
    filter: {
      filters: normalized.filters,
      orgId: input.tenant.orgId,
      ...(input.tenant.parentId === undefined
        ? {}
        : { parentId: input.tenant.parentId }),
      ...(normalized.search === undefined ? {} : { search: normalized.search }),
      ...(input.tenant.workspaceId === undefined
        ? {}
        : { workspaceId: input.tenant.workspaceId }),
    },
    sort: normalized.sort,
  };
  let afterId: string | undefined;
  if (input.query.cursor !== undefined) {
    try {
      afterId = input.codec.decode(
        input.query.cursor,
        cursorContext,
        inventoriedTableCursorPosition,
      );
    } catch (error) {
      if (error instanceof InvalidPageCursorError) {
        throw new ApiError(
          error.code,
          "Page cursor is invalid or expired.",
          400,
        );
      }
      throw error;
    }
  }
  const filtered = sortInventoriedTableRows(
    filterInventoriedTableRows(input.rows, normalized, input.policy),
    normalized.sort,
  );
  const startIndex =
    afterId === undefined
      ? 0
      : filtered.findIndex((row) => row.id === afterId) + 1;
  if (afterId !== undefined && startIndex === 0) {
    throw new ApiError(
      "invalid_page_cursor",
      "Page cursor is invalid or expired.",
      400,
    );
  }
  const items = filtered.slice(startIndex, startIndex + normalized.limit);
  const last = items.at(-1);
  const hasMore = startIndex + items.length < filtered.length;
  return {
    applied: {
      filters: normalized.filters,
      sort: [normalized.sort],
    },
    items,
    page: {
      estimatedTotal: filtered.length,
      limit: normalized.limit,
      nextCursor:
        hasMore && last !== undefined
          ? input.codec.encode({
              ...cursorContext,
              position: last.id,
            })
          : null,
      previousCursor: null,
    },
  };
}

export function inventoriedTableCursorPosition(
  value: unknown,
): string | undefined {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= 300
    ? value
    : undefined;
}

export function normalizeInventoriedTableQuery(
  query: InventoriedTableQuery,
  policy: InventoriedTablePolicy,
): {
  filters: InventoriedTableFilter[];
  limit: number;
  search?: string;
  sort: InventoriedTableSort;
} {
  const maxLimit = policy.maxLimit ?? inventoriedTableMaxLimit;
  const selected = query.sort[0];
  if (
    !Number.isSafeInteger(query.limit) ||
    query.limit < 1 ||
    query.limit > maxLimit ||
    query.sort.length > 1 ||
    query.filters.length > 20
  ) {
    throw invalidInventoriedTableQuery();
  }
  if (
    selected !== undefined &&
    !policy.sortFields.includes(selected.field)
  ) {
    throw invalidInventoriedTableQuery();
  }
  const seen = new Set<string>();
  for (const filter of query.filters) {
    if (seen.has(filter.field)) throw invalidInventoriedTableQuery();
    seen.add(filter.field);
    const operators = policy.filters[filter.field];
    if (operators === undefined || !operators.includes(filter.operator)) {
      throw invalidInventoriedTableQuery();
    }
  }
  const search = query.search?.trim();
  if (search !== undefined && (search.length < 1 || search.length > 200)) {
    throw invalidInventoriedTableQuery();
  }
  return {
    filters: query.filters,
    limit: query.limit,
    ...(search === undefined || search.length === 0 ? {} : { search }),
    sort: selected ?? policy.defaultSort,
  };
}

export function filterInventoriedTableRows(
  rows: readonly InventoriedTableRow[],
  query: {
    filters: InventoriedTableFilter[];
    search?: string;
  },
  policy: InventoriedTablePolicy,
): InventoriedTableRow[] {
  const search = query.search?.toLocaleLowerCase();
  return rows.filter((row) => {
    if (
      search !== undefined &&
      !policy.searchFields.some((field) =>
        cellText(row[field]).toLocaleLowerCase().includes(search),
      )
    ) {
      return false;
    }
    return query.filters.every((filter) => matchesFilter(row, filter));
  });
}

export function sortInventoriedTableRows(
  rows: readonly InventoriedTableRow[],
  sort: InventoriedTableSort,
): InventoriedTableRow[] {
  const direction = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    const compared = compareCells(left[sort.field], right[sort.field]);
    if (compared !== 0) return compared * direction;
    return left.id.localeCompare(right.id) * direction;
  });
}

function matchesFilter(
  row: InventoriedTableRow,
  filter: InventoriedTableFilter,
): boolean {
  if (filter.field === "status") {
    const status = rowStatus(row);
    if (filter.operator === "eq") return status === filter.value;
    if (filter.operator === "neq") return status !== filter.value;
  }
  const cell = row[filter.field];
  if (filter.operator === "eq") return cell === filter.value;
  if (filter.operator === "neq") return cell !== filter.value;
  if (filter.operator === "contains") {
    return (
      typeof filter.value === "string" &&
      cellText(cell).toLocaleLowerCase().includes(filter.value.toLocaleLowerCase())
    );
  }
  if (filter.operator === "is_null") return cell === undefined || cell === null;
  if (filter.operator === "not_null") return cell !== undefined && cell !== null;
  return false;
}

function rowStatus(row: InventoriedTableRow): string {
  if (typeof row.status === "string") return row.status;
  if (row.revokedAt !== undefined && row.revokedAt !== null) return "revoked";
  if (row.disabledAt !== undefined && row.disabledAt !== null) return "disabled";
  return "active";
}

function compareCells(left: unknown, right: unknown): number {
  if (left === right) return 0;
  if (left === undefined || left === null) return 1;
  if (right === undefined || right === null) return -1;
  if (typeof left === "number" && typeof right === "number") {
    return left === right ? 0 : left < right ? -1 : 1;
  }
  return cellText(left).localeCompare(cellText(right));
}

function cellText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) return value.map(cellText).join(" ");
  return "";
}

function invalidInventoriedTableQuery(): ApiError {
  return new ApiError(
    "invalid_request",
    "Table page query is invalid.",
    400,
  );
}

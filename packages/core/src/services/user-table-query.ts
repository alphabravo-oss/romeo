import type { User } from "../domain/entities";
import type { UserTableFilter, UserTableSortField } from "../domain/repository";
import { ApiError } from "../errors";

const roles = new Set(["global_admin", "org_admin", "user"]);

export interface UserTableFilterClause {
  field: string;
  operator: string;
  value?: unknown;
}

export interface UserTableQueryRequest {
  cursor?: string;
  filters: UserTableFilterClause[];
  limit: number;
  search?: string;
  sort: Array<{
    direction: "asc" | "desc";
    field: string;
    nulls?: "first" | "last";
  }>;
}

export interface UserTableAppliedFilterClause {
  field: "role" | "status";
  operator: "eq" | "in";
  value: string | string[];
}

export interface NormalizedUserTableQuery {
  appliedFilters: UserTableAppliedFilterClause[];
  filter: UserTableFilter;
  limit: number;
  search?: string;
  sort: {
    direction: "asc" | "desc";
    field: UserTableSortField;
  };
}

export interface UserTablePage {
  data: {
    applied: {
      filters: UserTableAppliedFilterClause[];
      sort: Array<{
        direction: "asc" | "desc";
        field: UserTableSortField;
      }>;
    };
    items: Array<User & { role: "global_admin" | "org_admin" | "user" }>;
    page: {
      estimatedTotal: number;
      limit: number;
      nextCursor: string | null;
      previousCursor: null;
    };
    summary: {
      activeGlobalAdminTotal: number;
      adminTotal: number;
      disabledTotal: number;
      userTotal: number;
    };
  };
}

export function normalizeUserTableQuery(
  request: UserTableQueryRequest,
): NormalizedUserTableQuery {
  const selectedSort = request.sort[0];
  if (
    !Number.isSafeInteger(request.limit) ||
    request.limit < 1 ||
    request.limit > 100 ||
    request.sort.length !== 1 ||
    selectedSort === undefined ||
    selectedSort.nulls !== undefined ||
    (selectedSort.field !== "email" && selectedSort.field !== "name") ||
    request.filters.length > 2
  ) {
    throw invalidUserTableQuery();
  }
  const filter: UserTableFilter = {};
  const appliedFilters: UserTableAppliedFilterClause[] = [];
  const seen = new Set<string>();
  for (const clause of request.filters) {
    if (seen.has(clause.field)) throw invalidUserTableQuery();
    seen.add(clause.field);
    if (clause.field === "status") {
      if (
        clause.operator !== "eq" ||
        (clause.value !== "active" && clause.value !== "disabled")
      )
        throw invalidUserTableQuery();
      filter.status = clause.value;
      appliedFilters.push({
        field: "status",
        operator: "eq",
        value: clause.value,
      });
      continue;
    }
    if (clause.field !== "role") throw invalidUserTableQuery();
    const operator =
      clause.operator === "eq"
        ? "eq"
        : clause.operator === "in"
          ? "in"
          : undefined;
    const values =
      operator === "eq" && typeof clause.value === "string"
        ? [clause.value]
        : operator === "in" && Array.isArray(clause.value)
          ? clause.value
          : undefined;
    if (
      values === undefined ||
      values.length < 1 ||
      values.length > 3 ||
      values.some((value) => typeof value !== "string" || !roles.has(value))
    )
      throw invalidUserTableQuery();
    const normalizedRoles = [...new Set(values)] as NonNullable<
      UserTableFilter["roles"]
    >;
    filter.roles = normalizedRoles;
    appliedFilters.push({
      field: "role",
      operator: operator!,
      value: operator === "eq" ? normalizedRoles[0]! : normalizedRoles,
    });
  }
  const search = request.search?.trim().toLocaleLowerCase();
  if (search !== undefined && (search.length < 3 || search.length > 200))
    throw invalidUserTableQuery();
  return {
    appliedFilters,
    filter,
    limit: request.limit,
    ...(search === undefined ? {} : { search }),
    sort: {
      direction: selectedSort.direction,
      field: selectedSort.field,
    },
  };
}

export function userCursorPosition(
  value: unknown,
): { id: string; value: string } | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as { id?: unknown }).id !== "string" ||
    typeof (value as { value?: unknown }).value !== "string"
  )
    return undefined;
  const position = value as { id: string; value: string };
  return position.id.length > 0 &&
    position.id.length <= 300 &&
    position.value.length > 0 &&
    position.value.length <= 500
    ? position
    : undefined;
}

function invalidUserTableQuery(): ApiError {
  return new ApiError(
    "invalid_user_table_query",
    "User table query is invalid.",
    400,
  );
}

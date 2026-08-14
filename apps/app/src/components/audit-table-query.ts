import { RomeoApiError } from "@romeo/api-client";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";

import { queryAuditLogs } from "../features";
import type { AuditLogFilter, AuditLogTableRequest } from "../features/types";
import * as appQueryKeys from "../lib/app-query-keys";
import { serverQueryPolicy } from "../lib/server-query-options";
import {
  AUDIT_ROUTE_CATEGORIES,
  type AuditRouteCategory,
  type AuditRouteSortDirection,
} from "../lib/audit-route-state";

export const AUDIT_PAGE_SIZE = 50;
export const AUDIT_SEARCH_DEBOUNCE_MS = 300;
export const AUDIT_SEARCH_MIN_LENGTH = 3;

export const AUDIT_CATEGORIES = AUDIT_ROUTE_CATEGORIES;
export type AuditCategory = AuditRouteCategory;
export type AuditSortDirection = AuditRouteSortDirection;

export interface AuditTableFilterInput {
  bounds: { from: Date | undefined; to: Date };
  category: AuditCategory | "";
  includeNoise: boolean;
  outcome: AuditLogFilter["outcome"] | "";
  search: string;
}

export function buildAuditTableRequest(
  input: AuditTableFilterInput & {
    cursor?: string;
    pageSize: number;
    sortDirection: AuditSortDirection;
  },
): AuditLogTableRequest {
  const filters: NonNullable<AuditLogTableRequest["filters"]> = [
    {
      field: "createdAt",
      operator: "lte",
      value: input.bounds.to.toISOString(),
    },
    { field: "includeNoise", operator: "eq", value: input.includeNoise },
  ];
  if (input.bounds.from !== undefined) {
    filters.push({
      field: "createdAt",
      operator: "gte",
      value: input.bounds.from.toISOString(),
    });
  }
  if (input.category !== "") {
    filters.push({ field: "category", operator: "eq", value: input.category });
  }
  if (input.outcome === "success" || input.outcome === "failure") {
    filters.push({ field: "outcome", operator: "eq", value: input.outcome });
  }
  const search = validAuditSearch(input.search);
  return {
    filters,
    limit: input.pageSize,
    sort: [{ field: "createdAt", direction: input.sortDirection }],
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    ...(search === "" ? {} : { search }),
  };
}

export function buildAuditExportFilter(
  input: AuditTableFilterInput,
): AuditLogFilter {
  const filter: AuditLogFilter = {
    includeNoise: input.includeNoise ? "true" : "false",
    to: input.bounds.to.toISOString(),
  };
  if (input.bounds.from !== undefined) {
    filter.from = input.bounds.from.toISOString();
  }
  const search = validAuditSearch(input.search);
  if (search !== "") filter.q = search;
  if (input.category !== "") filter.category = input.category;
  if (input.outcome === "success" || input.outcome === "failure") {
    filter.outcome = input.outcome;
  }
  return filter;
}

export function auditLogTableQueryOptions(
  request: AuditLogTableRequest,
  enabled = true,
) {
  return queryOptions({
    ...serverQueryPolicy("volatile", "auditLogs", {
      filters: request.filters,
      ...(request.search === undefined ? {} : { search: request.search }),
    }),
    enabled,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => queryAuditLogs(request, signal),
    queryKey: appQueryKeys.auditLogs(request),
  });
}

export function hasAuditFilters(input: AuditTableFilterInput): boolean {
  return (
    input.category !== "" ||
    input.outcome === "success" ||
    input.outcome === "failure" ||
    input.includeNoise ||
    validAuditSearch(input.search) !== ""
  );
}

export function isAuditSearchTooShort(search: string): boolean {
  const length = search.trim().length;
  return length > 0 && length < AUDIT_SEARCH_MIN_LENGTH;
}

function validAuditSearch(search: string): string {
  const normalized = search.trim();
  return normalized.length >= AUDIT_SEARCH_MIN_LENGTH ? normalized : "";
}

export function isInvalidAuditCursorError(error: unknown): boolean {
  return error instanceof RomeoApiError && error.code === "invalid_page_cursor";
}

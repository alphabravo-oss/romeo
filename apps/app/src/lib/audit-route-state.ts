import { RANGE_PRESETS, type RangePreset } from "../components/date-range";

export const AUDIT_ROUTE_CATEGORIES = [
  "security",
  "admin",
  "access",
  "data",
  "chat",
  "run",
  "system",
] as const;

export type AuditRouteCategory = (typeof AUDIT_ROUTE_CATEGORIES)[number];
export type AuditRouteSortDirection = "asc" | "desc";

export interface AuditRouteState {
  category: AuditRouteCategory | "";
  includeNoise: boolean;
  outcome: "" | "failure" | "success";
  pageSize: 10 | 25 | 50 | 100;
  range: RangePreset;
  sortDirection: AuditRouteSortDirection;
}

export interface AuditRouteSearchFields {
  auditCategory?: string;
  auditNoise?: boolean;
  auditOutcome?: string;
  auditPageSize?: number;
  auditRange?: string;
  auditSort?: string;
}

export const DEFAULT_AUDIT_ROUTE_STATE: AuditRouteState = {
  category: "",
  includeNoise: false,
  outcome: "",
  pageSize: 50,
  range: "7d",
  sortDirection: "desc",
};

const pageSizes = new Set<AuditRouteState["pageSize"]>([10, 25, 50, 100]);

/**
 * Resolve a bounded, non-sensitive table view from validated route search.
 * Opaque cursors and selected event IDs deliberately remain out of the URL.
 */
export function resolveAuditRouteState(
  search: AuditRouteSearchFields,
): AuditRouteState {
  return {
    category: isAuditCategory(search.auditCategory) ? search.auditCategory : "",
    includeNoise: search.auditNoise === true,
    outcome:
      search.auditOutcome === "success" || search.auditOutcome === "failure"
        ? search.auditOutcome
        : "",
    pageSize: isAuditPageSize(search.auditPageSize)
      ? search.auditPageSize
      : DEFAULT_AUDIT_ROUTE_STATE.pageSize,
    range: isRangePreset(search.auditRange)
      ? search.auditRange
      : DEFAULT_AUDIT_ROUTE_STATE.range,
    sortDirection:
      search.auditSort === "asc" || search.auditSort === "desc"
        ? search.auditSort
        : DEFAULT_AUDIT_ROUTE_STATE.sortDirection,
  };
}

/** Keep canonical URLs small by omitting defaults. */
export function auditRouteSearchFields(
  state: AuditRouteState,
): AuditRouteSearchFields {
  return {
    ...(state.category === "" ? {} : { auditCategory: state.category }),
    ...(state.includeNoise ? { auditNoise: true } : {}),
    ...(state.outcome === "" ? {} : { auditOutcome: state.outcome }),
    ...(state.pageSize === DEFAULT_AUDIT_ROUTE_STATE.pageSize
      ? {}
      : { auditPageSize: state.pageSize }),
    ...(state.range === DEFAULT_AUDIT_ROUTE_STATE.range
      ? {}
      : { auditRange: state.range }),
    ...(state.sortDirection === DEFAULT_AUDIT_ROUTE_STATE.sortDirection
      ? {}
      : { auditSort: state.sortDirection }),
  };
}

function isAuditCategory(value: unknown): value is AuditRouteCategory {
  return AUDIT_ROUTE_CATEGORIES.includes(value as AuditRouteCategory);
}

function isAuditPageSize(value: unknown): value is AuditRouteState["pageSize"] {
  return typeof value === "number" && pageSizes.has(value as never);
}

function isRangePreset(value: unknown): value is RangePreset {
  return RANGE_PRESETS.includes(value as RangePreset);
}

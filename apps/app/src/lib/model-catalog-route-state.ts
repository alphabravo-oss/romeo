import {
  defaultTableRouteState,
  parseTableRouteState,
  serializeTableRouteState,
  updateTableRouteState,
  type TableRoutePatch,
  type TableRouteState,
} from "./table-route-state";
import type {
  ModelAvailabilityFilter,
  ModelSort,
} from "../components/model-catalog-navigation";

export const modelCatalogRoutePolicy = {
  defaultPageSize: 25,
  defaultSort: "displayName",
  filterKeys: ["availability", "provider"] as const,
  pageSizes: [25] as const,
  sorts: [
    "availability",
    "contextWindow",
    "displayName",
    "enabled",
    "name",
  ] as const,
};

interface LegacyModelCatalogSearch {
  availability?: string;
  direction?: string;
  page?: number;
  provider?: string;
  query?: string;
  sort?: string;
  table?: string;
}

export interface ModelCatalogRouteState {
  availability: ModelAvailabilityFilter;
  direction: "asc" | "desc";
  page: number;
  providerId: string;
  query: string;
  sort: ModelSort;
}

export function resolveModelCatalogRouteState(
  search: LegacyModelCatalogSearch,
): ModelCatalogRouteState {
  const state = search.table
    ? parseTableRouteState(search.table, modelCatalogRoutePolicy)
    : legacyState(search);
  return {
    availability: modelAvailability(state.filters.availability),
    direction: state.direction,
    page: state.page,
    providerId: state.filters.provider ?? "all",
    query: state.query,
    sort: state.sort as ModelSort,
  };
}

export function updateModelCatalogRouteState(
  search: LegacyModelCatalogSearch,
  patch: {
    availability?: ModelAvailabilityFilter;
    direction?: "asc" | "desc";
    page?: number;
    provider?: string;
    query?: string;
    sort?: ModelSort;
  },
): string {
  const current = search.table
    ? parseTableRouteState(search.table, modelCatalogRoutePolicy)
    : legacyState(search);
  const filters = {
    ...current.filters,
    ...(patch.availability === undefined
      ? {}
      : { availability: patch.availability }),
    ...(patch.provider === undefined ? {} : { provider: patch.provider }),
  };
  const routePatch: TableRoutePatch = {
    filters,
    ...(patch.direction === undefined ? {} : { direction: patch.direction }),
    ...(patch.page === undefined ? {} : { page: patch.page }),
    ...(patch.query === undefined ? {} : { query: patch.query }),
    ...(patch.sort === undefined ? {} : { sort: patch.sort }),
  };
  return serializeTableRouteState(
    updateTableRouteState(current, routePatch, modelCatalogRoutePolicy),
    modelCatalogRoutePolicy,
  );
}

function legacyState(search: LegacyModelCatalogSearch): TableRouteState {
  return {
    ...defaultTableRouteState(modelCatalogRoutePolicy),
    direction: search.direction === "desc" ? "desc" : "asc",
    filters: {
      availability: modelAvailability(search.availability),
      provider: search.provider ?? "all",
    },
    page: search.page ?? 0,
    query: search.query ?? "",
    sort: modelCatalogRoutePolicy.sorts.includes(search.sort as ModelSort)
      ? (search.sort as ModelSort)
      : modelCatalogRoutePolicy.defaultSort,
  };
}

function modelAvailability(value: string | undefined): ModelAvailabilityFilter {
  if (value === "available" || value === "unavailable") return value;
  if (value === "enabled" || value === "disabled") return value;
  return "all";
}

import type { ProvidersListModelsData } from "@romeo/api-client/generated/query";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";

import { listModelsPage } from "../features/providers/queries";
import { modelCatalogQueryKey } from "../lib/api-query-options";
import { abortableQuery, serverQueryPolicy } from "../lib/server-query-options";
import type {
  ModelAvailabilityFilter,
  ModelSort,
} from "./model-catalog-navigation";

interface ModelCatalogRequestInput {
  availability: ModelAvailabilityFilter;
  direction: "asc" | "desc";
  page: number;
  providerId: string;
  query: string;
  sort: ModelSort;
}

type ModelCatalogRequest = Parameters<typeof listModelsPage>[0] &
  Required<
    Pick<
      Parameters<typeof listModelsPage>[0],
      "direction" | "limit" | "offset" | "sort"
    >
  >;

export function modelCatalogRequest(
  input: ModelCatalogRequestInput,
): ModelCatalogRequest {
  return {
    direction: input.direction,
    limit: 50,
    offset: input.page * 50,
    sort: input.sort,
    ...(input.query.trim() === "" ? {} : { query: input.query }),
    ...(input.providerId === "all" ? {} : { providerId: input.providerId }),
    ...(input.availability === "available" ||
    input.availability === "unavailable"
      ? { available: input.availability === "available" }
      : {}),
    ...(input.availability === "enabled" || input.availability === "disabled"
      ? { enabled: input.availability === "enabled" }
      : {}),
  };
}

export function modelCatalogApiQuery(
  request: ModelCatalogRequest,
): NonNullable<ProvidersListModelsData["query"]> {
  return {
    direction: request.direction,
    limit: request.limit,
    offset: request.offset,
    sort: request.sort,
    ...(request.query === undefined ? {} : { q: request.query }),
    ...(request.providerId === undefined
      ? {}
      : { providerId: request.providerId }),
    ...(request.available === undefined
      ? {}
      : { available: request.available ? "true" : "false" }),
    ...(request.enabled === undefined
      ? {}
      : { enabled: request.enabled ? "true" : "false" }),
  };
}

export function modelCatalogQueryOptions(input: ModelCatalogRequestInput) {
  const request = modelCatalogRequest(input);
  const query = modelCatalogApiQuery(request);
  return queryOptions({
    ...serverQueryPolicy("stable", "modelCatalog", { filters: query }),
    queryKey: modelCatalogQueryKey(query),
    queryFn: ({ signal }) =>
      abortableQuery(signal, () => listModelsPage(request)),
    placeholderData: keepPreviousData,
  });
}

import {
  providersGetOperationalSummary,
  providersListConnections,
  providersListModels,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

import type {
  BaseModel,
  ModelPage,
  Provider,
  ProviderOperationalSummary,
} from "./types";

export async function listProviders(): Promise<Provider[]> {
  configureBrowserApiClients();
  const response = await providersListConnections({ throwOnError: true });
  return response.data.data;
}

export async function listModels(): Promise<BaseModel[]> {
  configureBrowserApiClients();
  const response = await providersListModels({ throwOnError: true });
  return response.data.data;
}

export async function listModelsPage(input: {
  enabled?: boolean;
  limit: number;
  offset: number;
  providerId?: string;
  query?: string;
}): Promise<ModelPage> {
  configureBrowserApiClients();
  const response = await providersListModels({
    query: {
      limit: input.limit,
      offset: input.offset,
      ...(input.enabled === undefined
        ? {}
        : { enabled: String(input.enabled) as "false" | "true" }),
      ...(input.providerId === undefined
        ? {}
        : { providerId: input.providerId }),
      ...(input.query?.trim() ? { q: input.query.trim() } : {}),
    },
    throwOnError: true,
  });
  const meta = response.data.meta;
  if (meta === undefined) {
    return {
      items: response.data.data,
      limit: input.limit,
      offset: input.offset,
      total: response.data.data.length,
      hasMore: false,
    };
  }
  return { items: response.data.data, ...meta };
}

export async function getProviderOperationalSummary(): Promise<ProviderOperationalSummary> {
  configureBrowserApiClients();
  const response = await providersGetOperationalSummary({
    throwOnError: true,
  });
  return response.data.data;
}

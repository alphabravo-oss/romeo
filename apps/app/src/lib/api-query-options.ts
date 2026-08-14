import {
  identityGetCurrentPrincipalOptions,
  interfacePreferencesGetCurrentOptions,
  managedModelsListGalleryOptions,
  managedModelsListOptions,
  providersGetOperationalSummaryOptions,
  providersGetCapabilityReportOptions,
  providersGetModelCapabilityReportOptions,
  providersListConnectionsOptions,
  providersListKindsOptions,
  providersListModelsOptions,
  type ProvidersListModelsData,
} from "@romeo/api-client/generated/query";
import type { GeneratedQueryClient } from "@romeo/api-client/runtime/generated-query-client";
import { queryOptions } from "@tanstack/react-query";

import type { AgentGalleryItem } from "../features/managed-models";
import { queryCacheProfiles } from "./query-cache-policy";
import { devQueryDiagnosticMeta } from "./query-cache-diagnostics";

const routeQueryMeta = (
  resource: string,
  dimensions: Record<string, unknown> = {},
) =>
  ({
    ssr: true,
    ...devQueryDiagnosticMeta(resource, dimensions),
  }) as const;
const withClient = (client: GeneratedQueryClient | undefined) =>
  client === undefined ? {} : { client };

export const apiQueryKeys = {
  agentGallery: (workspaceId?: string) =>
    managedModelsListGalleryOptions(
      workspaceId === undefined ? {} : { query: { workspaceId } },
    ).queryKey,
  agents: (workspaceId?: string) =>
    managedModelsListOptions(
      workspaceId === undefined ? {} : { query: { workspaceId } },
    ).queryKey,
  bootstrap: () => identityGetCurrentPrincipalOptions().queryKey,
  interfacePreferences: () => interfacePreferencesGetCurrentOptions().queryKey,
  models: () => providersListModelsOptions().queryKey,
  providerOperationalSummary: () =>
    providersGetOperationalSummaryOptions().queryKey,
  providerKinds: () => providersListKindsOptions().queryKey,
  providerCapabilityReport: (providerId: string) =>
    providersGetCapabilityReportOptions({ path: { providerId } }).queryKey,
  providerModelCapabilityReport: (modelId: string) =>
    providersGetModelCapabilityReportOptions({ path: { modelId } }).queryKey,
  providers: () => providersListConnectionsOptions().queryKey,
} as const;

export const apiQueryKeyRoots = {
  providerCapabilityReports: () =>
    generatedQueryRoot(
      providersGetCapabilityReportOptions({ path: { providerId: "" } })
        .queryKey,
    ),
  providerModelCapabilityReports: () =>
    generatedQueryRoot(
      providersGetModelCapabilityReportOptions({ path: { modelId: "" } })
        .queryKey,
    ),
} as const;

export function bootstrapQueryOptions(client?: GeneratedQueryClient) {
  return queryOptions({
    ...identityGetCurrentPrincipalOptions(withClient(client)),
    ...queryCacheProfiles.interactive,
    // Bootstrap contains the raw authenticated subject, including optional
    // session/API-key identifiers and support-session metadata. It is useful
    // to request-scoped loaders, but must never cross the SSR boundary.
    meta: {
      ssr: false,
      ...devQueryDiagnosticMeta("bootstrap"),
    },
  });
}

export function bootstrapRevalidationQueryOptions(
  client?: GeneratedQueryClient,
) {
  return queryOptions({
    ...bootstrapQueryOptions(client),
    staleTime: 0,
  });
}

export function interfacePreferencesQueryOptions(
  client?: GeneratedQueryClient,
) {
  return queryOptions({
    ...interfacePreferencesGetCurrentOptions(withClient(client)),
    ...queryCacheProfiles.stable,
    meta: routeQueryMeta("interfacePreferences"),
    select: (
      response: ReturnTypeData<typeof interfacePreferencesGetCurrentOptions>,
    ) => response.data,
  });
}

export function modelsQueryOptions(client?: GeneratedQueryClient) {
  return queryOptions({
    ...providersListModelsOptions(withClient(client)),
    ...queryCacheProfiles.stable,
    meta: routeQueryMeta("models"),
    select: (response: ReturnTypeData<typeof providersListModelsOptions>) =>
      response.data,
  });
}

export function modelCatalogQueryKey(
  query: NonNullable<ProvidersListModelsData["query"]>,
  client?: GeneratedQueryClient,
) {
  return providersListModelsOptions({ ...withClient(client), query }).queryKey;
}

export function providersQueryOptions(client?: GeneratedQueryClient) {
  return queryOptions({
    ...providersListConnectionsOptions(withClient(client)),
    ...queryCacheProfiles.interactive,
    meta: routeQueryMeta("providers"),
    select: (
      response: ReturnTypeData<typeof providersListConnectionsOptions>,
    ) => response.data,
  });
}

export function providerKindsQueryOptions(client?: GeneratedQueryClient) {
  return queryOptions({
    ...providersListKindsOptions(withClient(client)),
    ...queryCacheProfiles.stable,
    meta: routeQueryMeta("providerKinds"),
    select: (response: ReturnTypeData<typeof providersListKindsOptions>) =>
      response.data,
  });
}

export function providerCapabilityReportQueryOptions(
  providerId: string,
  client?: GeneratedQueryClient,
) {
  return queryOptions({
    ...providersGetCapabilityReportOptions({
      ...withClient(client),
      path: { providerId },
    }),
    ...queryCacheProfiles.interactive,
    meta: routeQueryMeta("providerCapabilityReport", { providerId }),
    select: (
      response: ReturnTypeData<typeof providersGetCapabilityReportOptions>,
    ) => response.data,
  });
}

export function providerModelCapabilityReportQueryOptions(
  modelId: string,
  client?: GeneratedQueryClient,
) {
  return queryOptions({
    ...providersGetModelCapabilityReportOptions({
      ...withClient(client),
      path: { modelId },
    }),
    ...queryCacheProfiles.interactive,
    meta: routeQueryMeta("providerModelCapabilityReport", { modelId }),
    select: (
      response: ReturnTypeData<typeof providersGetModelCapabilityReportOptions>,
    ) => response.data,
  });
}

export function providerOperationalSummaryQueryOptions(
  client?: GeneratedQueryClient,
) {
  return queryOptions({
    ...providersGetOperationalSummaryOptions(withClient(client)),
    ...queryCacheProfiles.volatile,
    meta: routeQueryMeta("providerOperationalSummary"),
    select: (
      response: ReturnTypeData<typeof providersGetOperationalSummaryOptions>,
    ) => response.data,
  });
}

export function agentGalleryQueryOptions(
  workspaceId: string | undefined,
  client?: GeneratedQueryClient,
) {
  return queryOptions({
    ...managedModelsListGalleryOptions({
      ...withClient(client),
      ...(workspaceId === undefined ? {} : { query: { workspaceId } }),
    }),
    ...queryCacheProfiles.interactive,
    meta: routeQueryMeta("agentGallery", { workspaceId }),
    enabled: workspaceId !== undefined,
    select: (
      response: ReturnTypeData<typeof managedModelsListGalleryOptions>,
    ) => response.data,
  });
}

export function agentsQueryOptions(
  workspaceId: string,
  client?: GeneratedQueryClient,
) {
  return queryOptions({
    ...managedModelsListOptions({
      ...withClient(client),
      query: { workspaceId },
    }),
    ...queryCacheProfiles.interactive,
    meta: routeQueryMeta("agents", { workspaceId }),
    select: (response: ReturnTypeData<typeof managedModelsListOptions>) =>
      response.data,
  });
}

export function workspaceDraftAgentsQueryOptions(
  workspaceId: string | undefined,
  client?: GeneratedQueryClient,
  enabled = true,
) {
  return queryOptions({
    ...agentsQueryOptions(workspaceId ?? "", client),
    enabled: workspaceId !== undefined && enabled,
    refetchOnWindowFocus: true,
    select: (
      response: ReturnTypeData<typeof managedModelsListOptions>,
    ): AgentGalleryItem[] =>
      response.data.map((agent) => ({
        ...agent,
        favorite: false,
        readinessStatus:
          agent.publishedVersionId === undefined ? "blocked" : "ready",
        ...(agent.publishedVersionId === undefined
          ? {
              readinessReason: "Publish this custom model before using it.",
            }
          : {}),
      })),
  });
}

export function workspaceGalleryAgentsQueryOptions(
  workspaceId: string | undefined,
  client?: GeneratedQueryClient,
  enabled = true,
) {
  return queryOptions({
    ...agentGalleryQueryOptions(workspaceId, client),
    enabled: workspaceId !== undefined && enabled,
    refetchOnWindowFocus: true,
  });
}

export function workspaceModelsQueryOptions(client?: GeneratedQueryClient) {
  return queryOptions({
    ...modelsQueryOptions(client),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function workspaceProvidersQueryOptions(client?: GeneratedQueryClient) {
  return queryOptions({
    ...providersQueryOptions(client),
    refetchInterval: (query) =>
      query.state.data?.data.some(
        (provider) =>
          provider.catalogSync === undefined ||
          ["never", "stale", "syncing"].includes(provider.catalogSync.status),
      )
        ? 3_000
        : 60_000,
    refetchOnWindowFocus: true,
  });
}

type ReturnTypeData<TFactory extends (...args: never[]) => unknown> = Awaited<
  ReturnType<TFactory> extends { queryFn?: (...args: never[]) => infer TResult }
    ? TResult
    : never
>;

function generatedQueryRoot(queryKey: readonly [{ _id: string }]) {
  return [{ _id: queryKey[0]._id }] as const;
}

import {
  capabilitiesResolveEffective,
  type AuthSubject,
  type BootstrapResponse,
  type EffectiveCapability,
  type Workspace,
} from "@romeo/api-client/generated/query";
import type { GeneratedQueryClient } from "@romeo/api-client/runtime/generated-query-client";
import { queryOptions, type QueryClient } from "@tanstack/react-query";

import * as appQueryKeys from "./app-query-keys";
import { bootstrapQueryOptions } from "./api-query-options";
import { queryCacheProfiles } from "./query-cache-policy";
import { devQueryDiagnosticMeta } from "./query-cache-diagnostics";
import type { Locale } from "./i18n";

export interface RouterSessionSnapshot {
  locale: Locale;
  session: {
    authenticated: true;
    kind: "api_key" | "session" | "unknown";
  };
  subject: {
    id: string;
    isAdmin: boolean;
    orgId: string;
    type: AuthSubject["type"];
    workspaceIds: string[];
  };
  workspaces: Workspace[];
}

export interface ImageGenerationCapabilitySnapshot {
  imageGeneration: {
    allowedSizes: EffectiveCapability["effective"]["allowedSizes"];
    enabled: boolean;
    maxImagesPerRequest: number;
    status: EffectiveCapability["status"];
  };
  workspaceId: string;
}

export function sanitizeRouterSession(
  bootstrap: BootstrapResponse,
  locale: Locale,
): RouterSessionSnapshot {
  const { subject } = bootstrap;
  return {
    locale,
    session: {
      authenticated: true,
      kind:
        subject.sessionId !== undefined
          ? "session"
          : subject.apiKeyId !== undefined
            ? "api_key"
            : "unknown",
    },
    subject: {
      id: subject.id,
      isAdmin: subject.isAdmin === true,
      orgId: subject.orgId,
      type: subject.type,
      workspaceIds: [...subject.workspaceIds],
    },
    workspaces: bootstrap.workspaces
      .filter((workspace) => subject.workspaceIds.includes(workspace.id))
      .map((workspace) => ({
        ...(workspace.archivedAt === undefined
          ? {}
          : { archivedAt: workspace.archivedAt }),
        ...(workspace.defaultAgentId === undefined
          ? {}
          : { defaultAgentId: workspace.defaultAgentId }),
        id: workspace.id,
        name: workspace.name,
        orgId: workspace.orgId,
        slug: workspace.slug,
      })),
  };
}

export function routerSessionQueryOptions(
  locale: Locale,
  queryClient: QueryClient,
  client: GeneratedQueryClient,
) {
  return queryOptions({
    ...queryCacheProfiles.interactive,
    queryFn: async ({ signal }) => {
      const bootstrapOptions = bootstrapQueryOptions(client);
      // The raw bootstrap is shared by the shell and route authorization.
      // Leave its exact request alive when only this projection is cancelled;
      // the outer signal still prevents a late sanitized snapshot commit.
      const bootstrap = await queryClient.fetchQuery(bootstrapOptions);
      signal.throwIfAborted();
      return sanitizeRouterSession(bootstrap, locale);
    },
    queryKey: appQueryKeys.routerSession(locale),
    meta: {
      ssr: true,
      ...devQueryDiagnosticMeta("routerSession"),
    },
  });
}

export function routerSessionSnapshotQueryOptions(
  snapshot: RouterSessionSnapshot,
) {
  return queryOptions({
    ...queryCacheProfiles.interactive,
    queryFn: () => Promise.resolve(snapshot),
    queryKey: appQueryKeys.routerSession(snapshot.locale),
    meta: {
      ssr: true,
      ...devQueryDiagnosticMeta("routerSession"),
    },
  });
}

export function effectiveCapabilitiesQueryOptions(
  workspaceId: string,
  client: GeneratedQueryClient,
) {
  return queryOptions({
    ...queryCacheProfiles.interactive,
    queryFn: async ({ signal }) => {
      const response = await capabilitiesResolveEffective({
        body: {
          capabilityIds: ["image_generation"],
          context: { workspaceId },
        },
        client,
        signal,
        throwOnError: true,
      });
      return sanitizeImageGenerationCapability(
        workspaceId,
        response.data.data.find(
          (candidate) => candidate.capabilityId === "image_generation",
        ),
      );
    },
    queryKey: appQueryKeys.workspaceCapabilities(workspaceId),
    meta: {
      ssr: true,
      ...devQueryDiagnosticMeta("workspaceCapabilities", { workspaceId }),
    },
  });
}

export function effectiveCapabilitiesRevalidationQueryOptions(
  workspaceId: string,
  client: GeneratedQueryClient,
) {
  return queryOptions({
    ...effectiveCapabilitiesQueryOptions(workspaceId, client),
    staleTime: 0,
  });
}

export function sanitizeImageGenerationCapability(
  workspaceId: string,
  capability: EffectiveCapability | undefined,
): ImageGenerationCapabilitySnapshot {
  const status = capability?.status ?? "not_configured";
  return {
    imageGeneration: {
      allowedSizes: capability?.effective.allowedSizes ?? [],
      enabled: ["enabled", "normalized", "required"].includes(status),
      maxImagesPerRequest: capability?.effective.maxImagesPerRequest ?? 0,
      status,
    },
    workspaceId,
  };
}

export function getRouterSessionSnapshot(
  queryClient: QueryClient,
  locale: Locale,
): RouterSessionSnapshot | undefined {
  return queryClient.getQueryData(appQueryKeys.routerSession(locale));
}

import type { RomeoRouterContext } from "./router-context";
import { routeChatsInfiniteQueryOptions } from "../features/chats/query-options";
import {
  agentsQueryOptions,
  apiQueryKeys,
  bootstrapQueryOptions,
  interfacePreferencesQueryOptions,
  modelsQueryOptions,
  providerKindsQueryOptions,
  providerOperationalSummaryQueryOptions,
  providersQueryOptions,
} from "./api-query-options";
import {
  effectiveCapabilitiesQueryOptions,
  routerSessionQueryOptions,
} from "./router-runtime-data";
import {
  routeWorkspaceSelectionQueryOptions,
  type RouteWorkspaceSelection,
  type RouteWorkspaceSelectionRequest,
} from "./route-workspace-selection";
import type { BootstrapResponse } from "@romeo/api-client/generated/query";

export type PrimaryAppRoute = "admin" | "chat" | "settings" | "workspace";
export type PrimaryRouteLoadCause = "intent" | "navigation";

export class AdminRouteAuthorizationError extends Error {
  readonly code = "admin_route_not_authorized";
  readonly status = 404;

  constructor() {
    super("The requested route is unavailable.");
    this.name = "AdminRouteAuthorizationError";
  }
}

/**
 * Starts independent route data concurrently, then starts the one workspace-
 * scoped request as soon as bootstrap identifies a usable workspace.
 * Individual API failures remain in Query state so the existing panel-level
 * loading/error UX stays authoritative.
 */
export async function prefetchPrimaryRouteData(
  route: PrimaryAppRoute,
  { apiClient, locale, queryClient }: RomeoRouterContext,
  cause: PrimaryRouteLoadCause = "navigation",
  request: RouteWorkspaceSelectionRequest = {},
): Promise<RouteWorkspaceSelection | undefined> {
  if (cause === "intent") {
    await prefetchSafeRouteIntentData(route, {
      apiClient,
      locale,
      queryClient,
    });
    return undefined;
  }
  const selectionPromise = queryClient.fetchQuery(
    routeWorkspaceSelectionQueryOptions(request, queryClient, apiClient),
  );
  const independent = [
    queryClient.prefetchQuery(interfacePreferencesQueryOptions(apiClient)),
    queryClient.prefetchQuery(
      routerSessionQueryOptions(locale, queryClient, apiClient),
    ),
  ];

  if (route !== "settings" && route !== "admin") {
    independent.push(
      queryClient.prefetchQuery(modelsQueryOptions(apiClient)),
      queryClient.prefetchQuery(providersQueryOptions(apiClient)),
      queryClient.prefetchQuery(
        providerOperationalSummaryQueryOptions(apiClient),
      ),
    );
  }
  const selection = await selectionPromise;
  if (route === "admin") {
    const bootstrap = queryClient.getQueryData<BootstrapResponse>(
      apiQueryKeys.bootstrap(),
    );
    if (bootstrap?.subject.isAdmin !== true) {
      await Promise.allSettled(independent);
      throw new AdminRouteAuthorizationError();
    }
    independent.push(
      queryClient.prefetchQuery(modelsQueryOptions(apiClient)),
      queryClient.prefetchQuery(providersQueryOptions(apiClient)),
      queryClient.prefetchQuery(
        providerOperationalSummaryQueryOptions(apiClient),
      ),
      queryClient.prefetchQuery(providerKindsQueryOptions(apiClient)),
    );
  }
  if (route !== "settings") {
    independent.push(
      queryClient.prefetchQuery(
        agentsQueryOptions(selection.workspaceId, apiClient),
      ),
      queryClient.prefetchInfiniteQuery(
        routeChatsInfiniteQueryOptions(selection.workspaceId, apiClient),
      ),
    );
  }
  if (route === "chat" || route === "workspace") {
    independent.push(
      queryClient.prefetchQuery(
        effectiveCapabilitiesQueryOptions(selection.workspaceId, apiClient),
      ),
    );
  }

  await Promise.allSettled(independent);
  return selection;
}

/**
 * Intent is intentionally narrower than navigation. Admin data, provider
 * inventory/health, transcripts, prompts, exports, probes, and mutations are
 * excluded. Selected-workspace intent data is handled by the client intent
 * hook, which validates the current selection against the subject allowlist.
 */
async function prefetchSafeRouteIntentData(
  route: PrimaryAppRoute,
  { apiClient, locale, queryClient }: RomeoRouterContext,
): Promise<void> {
  if (route === "admin") return;

  const bootstrapData = await queryClient
    .fetchQuery(bootstrapQueryOptions(apiClient))
    .catch(() => undefined);
  if (bootstrapData === undefined) return;

  const safePrefetches = [
    queryClient.prefetchQuery(interfacePreferencesQueryOptions(apiClient)),
    queryClient.prefetchQuery(
      routerSessionQueryOptions(locale, queryClient, apiClient),
    ),
  ];
  await Promise.allSettled(safePrefetches);
}

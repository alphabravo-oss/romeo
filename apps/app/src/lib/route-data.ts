import type { RomeoRouterContext } from "./router-context";
import { routeChatsInfiniteQueryOptions } from "../features/chats/query-options";
import {
  agentsQueryOptions,
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
import { throwIfSignalAborted } from "./abort-signal";
import { activeRouteLocale } from "./i18n";

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
  signal?: AbortSignal,
): Promise<RouteWorkspaceSelection | undefined> {
  const cancelUnusedRouteQueries = () => {
    void queryClient.cancelQueries({
      predicate: (query) =>
        query.getObserversCount() === 0 &&
        query.state.fetchStatus === "fetching" &&
        routeQueryOperationIds.has(queryOperationId(query.queryKey)),
    });
  };
  signal?.addEventListener("abort", cancelUnusedRouteQueries, { once: true });
  try {
    throwIfSignalAborted(signal);
    const routeLocale = activeRouteLocale(locale);
    if (cause === "intent") {
      await prefetchSafeRouteIntentData(route, {
        apiClient,
        locale: routeLocale,
        queryClient,
      });
      throwIfSignalAborted(signal);
      return undefined;
    }
    const selectionPromise = queryClient.fetchQuery(
      routeWorkspaceSelectionQueryOptions(request, queryClient, apiClient),
    );
    const independent = [
      queryClient.prefetchQuery(interfacePreferencesQueryOptions(apiClient)),
      queryClient.prefetchQuery(
        routerSessionQueryOptions(routeLocale, queryClient, apiClient),
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
    // Admin authorization must await the authoritative bootstrap value. A
    // cached route-selection result can resolve without executing its nested
    // bootstrap query, and the concurrent session projection may still be in
    // flight on a cold document navigation. Reading the cache at that point
    // incorrectly denied real administrators. TanStack deduplicates this
    // exact bootstrap read with both of those consumers.
    const [selection, adminBootstrap] = await Promise.all([
      selectionPromise,
      route === "admin"
        ? queryClient.fetchQuery(bootstrapQueryOptions(apiClient))
        : Promise.resolve(undefined),
    ]);
    throwIfSignalAborted(signal);
    if (route === "admin") {
      if (adminBootstrap?.subject.isAdmin !== true) {
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
    if (route === "admin" || route === "chat" || route === "workspace") {
      independent.push(
        queryClient.prefetchQuery(
          agentsQueryOptions(selection.workspaceId, apiClient),
        ),
      );
    }
    if (route === "chat") {
      independent.push(
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
    throwIfSignalAborted(signal);
    return selection;
  } catch (error) {
    // A superseded route is control flow, not a route error. TanStack Router
    // aborts stale matches without a reason in some hydration/navigation
    // races; allowing that raw cancellation to escape records an `undefined`
    // match error and can tear down the rendered route. The router already
    // owns discarding the stale result, so resolve it without data after all
    // unobserved work has been cancelled.
    if (signal?.aborted === true) return undefined;
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancelUnusedRouteQueries);
  }
}

const routeQueryOperationIds = new Set([
  "agentsList",
  "chats",
  "interfacePreferencesGetCurrent",
  "managedModelsList",
  "providerKindsList",
  "providersGetOperationalSummary",
  "providersListConnections",
  "providersListModels",
  "routeWorkspaceSelection",
  "routerSession",
  "workspaceCapabilities",
]);

function queryOperationId(queryKey: readonly unknown[]): string {
  const root = queryKey[0];
  if (typeof root === "string") return root;
  return typeof root === "object" && root !== null && "_id" in root
    ? String(root._id)
    : "unknown";
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

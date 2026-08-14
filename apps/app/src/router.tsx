import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import {
  createIsomorphicFn,
  getGlobalStartContext,
} from "@tanstack/react-start";

import {
  RouteErrorBoundary,
  RouteNotFound,
} from "./components/RouteErrorBoundary";
import { RouteLoadingState } from "./components/RouteLoadingState";
import { routeTree } from "./routeTree.gen";
import {
  createRomeoQueryClient,
  routeDehydrateOptions,
} from "./lib/query-client";
import { getRouterApiClient } from "./lib/router-api-client";
import type { RomeoRouterContext } from "./lib/router-context";
import { getRouterLocale } from "./lib/router-locale";

export function getRouter() {
  const context: RomeoRouterContext = {
    apiClient: getRouterApiClient(),
    locale: getRouterLocale(),
    queryClient: createRomeoQueryClient(),
  };
  const nonce = getCspNonce();
  const router = createRouter({
    routeTree,
    context,
    // Intent preloading is deliberately opt-in. Some routes (notably admin)
    // own privileged or operational datasets that must not be warmed merely
    // because a link is rendered or crossed by the pointer.
    defaultPreload: false,
    defaultPreloadDelay: 75,
    scrollRestoration: true,
    ...(nonce === undefined ? {} : { ssr: { nonce } }),
    /*
     * Set as router defaults rather than per route: before this, a throw in any
     * of the ~136 panels unmounted the whole tree to a blank document. Defining
     * them here means a newly added route inherits a boundary instead of having
     * to remember one.
     */
    defaultErrorComponent: RouteErrorBoundary,
    defaultNotFoundComponent: RouteNotFound,
    defaultPendingComponent: RouteLoadingState,
  });
  setupRouterSsrQueryIntegration({
    router,
    queryClient: context.queryClient,
    dehydrateOptions: routeDehydrateOptions,
  });
  return router;
}

const getCspNonce = createIsomorphicFn()
  .client(() => undefined)
  .server(() => {
    const context = getGlobalStartContext() as
      | { cspNonce?: string }
      | undefined;
    return context?.cspNonce;
  });

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}

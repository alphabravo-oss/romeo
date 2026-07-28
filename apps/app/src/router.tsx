import { createRouter } from "@tanstack/react-router";

import {
  RouteErrorBoundary,
  RouteNotFound,
} from "./components/RouteErrorBoundary";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
    defaultPreload: "intent",
    scrollRestoration: true,
    /*
     * Set as router defaults rather than per route: before this, a throw in any
     * of the ~136 panels unmounted the whole tree to a blank document. Defining
     * them here means a newly added route inherits a boundary instead of having
     * to remember one.
     */
    defaultErrorComponent: RouteErrorBoundary,
    defaultNotFoundComponent: RouteNotFound,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}

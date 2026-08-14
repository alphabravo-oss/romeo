import {
  MutationCache,
  QueryClient,
  type DehydrateOptions,
  type Query,
} from "@tanstack/react-query";

import { queryCacheProfiles } from "./query-cache-policy";
import { installQueryCacheDiagnostics } from "./query-cache-diagnostics";
import { assertMutationNetworkReady } from "./connectivity";

export function createRomeoQueryClient(): QueryClient {
  const queryClient = new QueryClient({
    mutationCache: new MutationCache({
      onMutate: () => {
        assertMutationNetworkReady();
      },
    }),
    defaultOptions: {
      mutations: {
        // `online` would pause and silently queue writes. `always` enters the
        // global onMutate gate immediately, which fails closed with no fetch.
        networkMode: "always",
        retry: false,
      },
      queries: {
        ...queryCacheProfiles.interactive,
      },
    },
  });
  if (import.meta.env.DEV) installQueryCacheDiagnostics(queryClient);
  return queryClient;
}

/** Only explicitly approved, successful route data may cross the SSR boundary. */
export function shouldDehydrateRouteQuery(query: Query): boolean {
  return query.state.status === "success" && query.meta?.ssr === true;
}

export const routeDehydrateOptions: DehydrateOptions = {
  shouldDehydrateQuery: shouldDehydrateRouteQuery,
};

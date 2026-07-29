import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";

import { WorkspaceProvider } from "../components/WorkspaceContext";
import { AsyncErrorReporter } from "../components/AsyncErrorReporter";
import { ConnectivityStatus } from "../components/ConnectivityStatus";
import { queryRetryDelay, shouldRetryQuery } from "../lib/query-policy";

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            refetchOnWindowFocus: false,
            retry: shouldRetryQuery,
            retryDelay: queryRetryDelay,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <WorkspaceProvider>
        <AsyncErrorReporter />
        <ConnectivityStatus />
        {children}
      </WorkspaceProvider>
    </QueryClientProvider>
  );
}

import type { GeneratedQueryClient } from "@romeo/api-client/runtime/generated-query-client";
import type { QueryClient, QueryKey } from "@tanstack/react-query";

import * as appQueryKeys from "./app-query-keys";
import { effectiveCapabilitiesQueryOptions } from "./router-runtime-data";
import { advanceMutationSessionBoundary } from "./mutation-session-boundary";

function workspaceIntentKeys(workspaceId: string): QueryKey[] {
  return [appQueryKeys.workspaceCapabilities(workspaceId)];
}

/** Prefetch one bounded capability snapshot after validating membership. */
export async function prefetchAuthorizedWorkspaceIntentData(
  queryClient: QueryClient,
  apiClient: GeneratedQueryClient,
  workspaceId: string | undefined,
  authorizedWorkspaceIds: readonly string[],
): Promise<boolean> {
  if (
    workspaceId === undefined ||
    !authorizedWorkspaceIds.includes(workspaceId)
  ) {
    return false;
  }
  await queryClient.prefetchQuery(
    effectiveCapabilitiesQueryOptions(workspaceId, apiClient),
  );
  return true;
}

/** Cancel and discard speculative data scoped to a workspace being left. */
export async function cancelWorkspaceIntentData(
  queryClient: QueryClient,
  workspaceId: string,
): Promise<void> {
  const keys = workspaceIntentKeys(workspaceId);
  await Promise.all(
    keys.map((queryKey) =>
      queryClient.cancelQueries({ exact: true, queryKey }),
    ),
  );
  for (const queryKey of keys) {
    queryClient.removeQueries({ exact: true, queryKey });
  }
}

/** Logout/revocation is a privacy boundary: no prefetched cache may survive. */
export async function clearRouteDataForLogout(
  queryClient: QueryClient,
): Promise<void> {
  advanceMutationSessionBoundary();
  await queryClient.cancelQueries();
  queryClient.clear();
}

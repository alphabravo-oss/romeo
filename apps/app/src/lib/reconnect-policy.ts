import type { GeneratedQueryClient } from "@romeo/api-client/runtime/generated-query-client";
import type { Query, QueryClient } from "@tanstack/react-query";

import { bootstrapRevalidationQueryOptions } from "./api-query-options";
import {
  beginMutationNetworkRevalidation,
  completeMutationNetworkRevalidation,
  failMutationNetworkRevalidation,
} from "./connectivity";
import { effectiveCapabilitiesRevalidationQueryOptions } from "./router-runtime-data";

const securityResourcePattern =
  /access|capabilit|entitlement|grant|permission|policy/u;

export function isReconnectSecurityQuery(query: Query): boolean {
  const diagnosticResource = (
    query.meta as { queryDiagnostic?: { resource?: unknown } } | undefined
  )?.queryDiagnostic?.resource;
  const searchable =
    typeof diagnosticResource === "string"
      ? diagnosticResource
      : JSON.stringify(query.queryKey);
  // The selected workspace capability snapshot is fetched explicitly above;
  // excluding it here prevents a duplicate request in the active-query pass.
  if (
    searchable === "workspaceCapabilities" ||
    query.queryKey[0] === "workspaceCapabilities"
  )
    return false;
  return securityResourcePattern.test(searchable.toLowerCase());
}

/**
 * Re-establishes the minimum safe mutation boundary. Precise mutation authz is
 * still re-evaluated by the API; this gate prevents a stale browser session or
 * workspace selection from sending any write before that retry.
 */
export async function revalidateAfterReconnect(input: {
  apiClient: GeneratedQueryClient;
  queryClient: QueryClient;
  workspaceId: string | undefined;
}): Promise<void> {
  beginMutationNetworkRevalidation();
  try {
    const bootstrap = await input.queryClient.fetchQuery(
      bootstrapRevalidationQueryOptions(input.apiClient),
    );
    if (
      input.workspaceId !== undefined &&
      !bootstrap.subject.workspaceIds.includes(input.workspaceId)
    ) {
      throw new Error("Workspace authorization changed during reconnect.");
    }
    if (input.workspaceId !== undefined) {
      await input.queryClient.fetchQuery(
        effectiveCapabilitiesRevalidationQueryOptions(
          input.workspaceId,
          input.apiClient,
        ),
      );
    }
    await input.queryClient.refetchQueries(
      { predicate: isReconnectSecurityQuery, type: "active" },
      { throwOnError: true },
    );
    completeMutationNetworkRevalidation();
  } catch (error) {
    failMutationNetworkRevalidation();
    throw error;
  }
}

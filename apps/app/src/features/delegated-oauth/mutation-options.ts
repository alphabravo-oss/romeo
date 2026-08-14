import * as appQueryKeys from "../../lib/app-query-keys";
import { currentMutationSessionVersion } from "../../lib/mutation-session-boundary";
import {
  invalidateCachedResourceExactly,
  serverMutationOptions,
} from "../../lib/server-mutation-options";
import {
  revokeDelegatedOAuthConnection,
  startDelegatedOAuth,
} from "./mutations";
import type { DelegatedOAuthConnectionSummary } from "./types";

export function startDelegatedOAuthMutationOptions() {
  return serverMutationOptions({
    ephemeral: true,
    resource: "delegatedOAuth.start",
    mutationFn: async (input: Parameters<typeof startDelegatedOAuth>[0]) => {
      const sessionVersion = currentMutationSessionVersion();
      const result = await startDelegatedOAuth(input);
      if (sessionVersion !== currentMutationSessionVersion()) {
        throw new Error("The authentication session changed.");
      }
      return result;
    },
    reconcile: (client) =>
      invalidateCachedResourceExactly(client, appQueryKeys.auditLogs()),
  });
}

export function revokeDelegatedOAuthConnectionMutationOptions() {
  return serverMutationOptions({
    resource: "delegatedOAuth.connection.revoke",
    mutationFn: revokeDelegatedOAuthConnection,
    reconcile: async (client, connection: DelegatedOAuthConnectionSummary) => {
      for (const query of client.getQueryCache().findAll({
        queryKey: appQueryKeys.delegatedOAuthConnections(),
      })) {
        client.setQueryData<DelegatedOAuthConnectionSummary[]>(
          query.queryKey,
          (current) =>
            current?.map((item) =>
              item.id === connection.id ? connection : item,
            ),
        );
      }
      await Promise.all([
        invalidateCachedResourceExactly(
          client,
          appQueryKeys.delegatedOAuthConnections(),
        ),
        invalidateCachedResourceExactly(client, appQueryKeys.dataConnectors()),
        invalidateCachedResourceExactly(client, appQueryKeys.auditLogs()),
      ]);
    },
    invalidations: () => [
      { exact: true, queryKey: appQueryKeys.delegatedOAuthPosture() },
      { exact: true, queryKey: appQueryKeys.dataConnectorCatalog() },
    ],
  });
}

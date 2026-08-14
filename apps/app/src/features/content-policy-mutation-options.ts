import * as appQueryKeys from "../lib/app-query-keys";
import { serverMutationOptions } from "../lib/server-mutation-options";
import {
  simulateContentPolicy,
  updateContentPolicy,
  type ContentPolicyReport,
} from "./content-policy";

export function updateContentPolicyMutationOptions() {
  return serverMutationOptions<
    Awaited<ReturnType<typeof updateContentPolicy>>,
    Error,
    Parameters<typeof updateContentPolicy>[0],
    ContentPolicyReport | undefined
  >({
    resource: "contentPolicy.update",
    mutationFn: updateContentPolicy,
    optimistic: {
      snapshot: async (client) => {
        const queryKey = appQueryKeys.contentPolicy();
        await client.cancelQueries({ exact: true, queryKey });
        return client.getQueryData<ContentPolicyReport>(queryKey);
      },
      update: (client, variables) => {
        client.setQueryData<ContentPolicyReport>(
          appQueryKeys.contentPolicy(),
          (current) =>
            current === undefined
              ? undefined
              : {
                  ...current,
                  detectors: { ...current.detectors, ...variables.detectors },
                },
        );
      },
      rollback: (client, snapshot) => {
        const queryKey = appQueryKeys.contentPolicy();
        if (snapshot === undefined) {
          client.removeQueries({ exact: true, queryKey });
        } else {
          client.setQueryData(queryKey, snapshot);
        }
      },
    },
    reconcile: (client, updated) => {
      client.setQueryData(appQueryKeys.contentPolicy(), updated);
    },
  });
}

export function simulateContentPolicyMutationOptions() {
  return serverMutationOptions({
    resource: "contentPolicy.simulate",
    mutationFn: simulateContentPolicy,
  });
}

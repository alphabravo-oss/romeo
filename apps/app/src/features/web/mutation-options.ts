import * as appQueryKeys from "../../lib/app-query-keys";
import { serverMutationOptions } from "../../lib/server-mutation-options";
import { ingestWebUrls, updateWebSearchConfiguration } from "./mutations";

type WebSearchConfigurationInput = Parameters<
  typeof updateWebSearchConfiguration
>[0];

export function updateWebSearchConfigurationMutationOptions() {
  return serverMutationOptions({
    ephemeral: true,
    resource: "webSearch.configuration.update",
    mutationFn: (input: WebSearchConfigurationInput) =>
      updateWebSearchConfiguration(input),
    reconcile: (client, configuration) => {
      client.setQueryData(appQueryKeys.webSearchConfiguration(), configuration);
    },
    invalidations: () => [
      { exact: true, queryKey: appQueryKeys.webSearchConfiguration() },
    ],
  });
}

export function ingestWebUrlsMutationOptions() {
  return serverMutationOptions({
    ephemeral: true,
    resource: "webSearch.url.ingest",
    mutationFn: ingestWebUrls,
    invalidations: (_result, { workspaceId }) => [
      { exact: true, queryKey: appQueryKeys.files(workspaceId) },
    ],
  });
}

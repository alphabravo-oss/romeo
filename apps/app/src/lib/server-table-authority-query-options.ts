import {
  tableExportsGet,
  tableViewsList,
} from "@romeo/api-client/generated/sdk";
import {
  zServerTableSavedView,
  zTableExportJob,
} from "@romeo/api-client/generated/sdk/zod";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";
import { queryOptions } from "@tanstack/react-query";

import * as appQueryKeys from "./app-query-keys";
import type { InventoriedTableResourceName } from "./inventoried-table-resource-registry";
import { serverQueryPolicy } from "./server-query-options";

export function serverTableViewsQueryOptions(
  workspaceId: string | undefined,
  resource: InventoriedTableResourceName | undefined,
  parentId: string | undefined,
  enabled: boolean,
) {
  return queryOptions({
    ...serverQueryPolicy("stable", "tableViews", { resource, workspaceId }),
    enabled: enabled && workspaceId !== undefined && resource !== undefined,
    queryKey: appQueryKeys.tableViews(workspaceId, resource, parentId),
    queryFn: async ({ signal }) => {
      if (workspaceId === undefined || resource === undefined) return [];
      configureBrowserApiClients();
      const response = await tableViewsList({
        body: {
          workspaceId,
          resource,
          ...(parentId === undefined ? {} : { parentId }),
        },
        signal,
        throwOnError: true,
      });
      return response.data.data.map((view) =>
        zServerTableSavedView.parse(view),
      );
    },
  });
}

export function serverTableExportJobQueryOptions(
  jobId: string | undefined,
  enabled: boolean,
) {
  return queryOptions({
    ...serverQueryPolicy("volatile", "tableExport", { jobId }),
    enabled: enabled && jobId !== undefined,
    queryKey: appQueryKeys.tableExport(jobId),
    queryFn: async ({ signal }) => {
      if (jobId === undefined) return undefined;
      configureBrowserApiClients();
      const response = await tableExportsGet({
        path: { jobId },
        signal,
        throwOnError: true,
      });
      return zTableExportJob.parse(response.data.data);
    },
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      return state === undefined || state === "queued" || state === "running"
        ? 1_000
        : false;
    },
  });
}

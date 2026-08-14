import { queryOptions } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import {
  abortableQuery,
  serverQueryPolicy,
} from "../../lib/server-query-options";
import {
  listWorkflowRuns,
  listWorkflows,
  listWorkflowTemplates,
} from "./queries";

export function workflowsQueryOptions(workspaceId?: string) {
  return queryOptions({
    ...serverQueryPolicy("interactive", "workflows", { workspaceId }),
    queryKey: appQueryKeys.workflows(workspaceId),
    queryFn: ({ signal }) =>
      abortableQuery(signal, () => listWorkflows(workspaceId)),
    enabled: workspaceId !== undefined,
  });
}

export function workflowTemplatesQueryOptions(workspaceId?: string) {
  return queryOptions({
    ...serverQueryPolicy("stable", "workflowTemplates", { workspaceId }),
    queryKey: appQueryKeys.workflowTemplates(workspaceId),
    queryFn: ({ signal }) => abortableQuery(signal, listWorkflowTemplates),
  });
}

export function workflowRunsQueryOptions(workflowId?: string) {
  return queryOptions({
    ...serverQueryPolicy("volatile", "workflowRuns", { workflowId }),
    queryKey: appQueryKeys.workflowRuns(workflowId),
    queryFn: ({ signal }) =>
      abortableQuery(signal, () => listWorkflowRuns(workflowId!)),
    enabled: workflowId !== undefined,
  });
}

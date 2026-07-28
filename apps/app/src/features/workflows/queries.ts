import {
  workflowsList,
  workflowsListRuns,
  workflowsListTemplates,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export async function listWorkflows(workspaceId?: string) {
  configureBrowserApiClients();
  const response = await workflowsList({
    query: workspaceId === undefined ? {} : { workspaceId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function listWorkflowTemplates() {
  configureBrowserApiClients();
  const response = await workflowsListTemplates({ throwOnError: true });
  return response.data.data;
}

export async function listWorkflowRuns(workflowId: string) {
  configureBrowserApiClients();
  const response = await workflowsListRuns({
    path: { workflowId },
    throwOnError: true,
  });
  return response.data.data;
}

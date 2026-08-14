import * as appQueryKeys from "../../lib/app-query-keys";
import { serverMutationOptions } from "../../lib/server-mutation-options";
import { RomeoApiError } from "@romeo/api-client";
import { executeTool, updateAgentToolBinding } from "./mutations";
import type { AgentToolSummary } from "./types";
import { refreshToolActivityQueries } from "./cache-policy";

type AgentToolSnapshot = AgentToolSummary[] | undefined;

export function updateAgentToolBindingMutationOptions() {
  return serverMutationOptions<
    Awaited<ReturnType<typeof updateAgentToolBinding>>,
    Error,
    Parameters<typeof updateAgentToolBinding>[0],
    AgentToolSnapshot
  >({
    resource: "managedModel.toolBinding.update",
    mutationFn: updateAgentToolBinding,
    optimistic: {
      snapshot: async (client, variables) => {
        const queryKey = appQueryKeys.agentTools(variables.agentId);
        await client.cancelQueries({ exact: true, queryKey });
        return client.getQueryData<AgentToolSummary[]>(queryKey);
      },
      update: (client, variables) => {
        client.setQueryData<AgentToolSummary[]>(
          appQueryKeys.agentTools(variables.agentId),
          (current) =>
            current?.map((tool) =>
              tool.id === variables.toolId ? { ...tool, ...variables } : tool,
            ),
        );
      },
      rollback: (client, snapshot, variables) => {
        const queryKey = appQueryKeys.agentTools(variables.agentId);
        if (snapshot === undefined)
          client.removeQueries({ exact: true, queryKey });
        else client.setQueryData(queryKey, snapshot);
      },
    },
    reconcile: (client, tool, variables) => {
      client.setQueryData<AgentToolSummary[]>(
        appQueryKeys.agentTools(variables.agentId),
        (current) =>
          current?.map((entry) => (entry.id === tool.id ? tool : entry)),
      );
    },
    invalidations: (_tool, variables) => [
      { exact: true, queryKey: appQueryKeys.agentTools(variables.agentId) },
    ],
  });
}

export interface ExecuteToolVariables {
  agentId: string;
  runId?: string;
  payload: unknown;
  approved?: boolean;
  approvalRequestId?: string;
}

export function executeToolMutationOptions<TOutput>(toolId: string) {
  return serverMutationOptions<TOutput, Error, ExecuteToolVariables>({
    resource: `tool.execute.${toolId}`,
    mutationFn: (variables) => executeTool<TOutput>({ toolId, ...variables }),
    reconcile: (client, _result, variables) =>
      refreshToolActivityQueries(client, variables.agentId),
    reconcileError: (client, error, variables) =>
      error instanceof RomeoApiError && error.code === "tool_approval_required"
        ? refreshToolActivityQueries(client, variables.agentId)
        : undefined,
  });
}

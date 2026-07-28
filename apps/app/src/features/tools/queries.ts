import {
  toolsList,
  toolsListAgentBindings,
  toolsListCalls,
  type AgentToolSummary,
  type ToolCallRecord,
  type ToolSummary,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export async function listTools(): Promise<ToolSummary[]> {
  configureBrowserApiClients();
  const response = await toolsList({ throwOnError: true });
  return response.data.data;
}

export async function listAgentTools(
  agentId: string,
): Promise<AgentToolSummary[]> {
  configureBrowserApiClients();
  const response = await toolsListAgentBindings({
    path: { agentId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function listToolCalls(
  agentId?: string,
): Promise<ToolCallRecord[]> {
  configureBrowserApiClients();
  const response = await toolsListCalls({
    query: agentId === undefined ? {} : { agentId },
    throwOnError: true,
  });
  return response.data.data;
}

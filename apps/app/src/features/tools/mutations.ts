import {
  toolsUpdateAgentBinding,
  toolsExecute,
  type AgentToolSummary,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export async function updateAgentToolBinding(input: {
  agentId: string;
  toolId: string;
  enabled?: boolean;
  approvalRequired?: boolean;
}): Promise<AgentToolSummary> {
  const { agentId, toolId, enabled, approvalRequired } = input;
  configureBrowserApiClients();
  const response = await toolsUpdateAgentBinding({
    path: { agentId, toolId },
    body: {
      ...(enabled === undefined ? {} : { enabled }),
      ...(approvalRequired === undefined ? {} : { approvalRequired }),
    },
    throwOnError: true,
  });
  return response.data.data;
}

export async function executeTool<TOutput>(input: {
  toolId: string;
  agentId: string;
  runId?: string;
  payload: unknown;
  approved?: boolean;
  approvalRequestId?: string;
}): Promise<TOutput> {
  const { toolId, payload, ...body } = input;
  configureBrowserApiClients();
  const response = await toolsExecute({
    path: { toolId },
    body: { ...body, input: payload },
    throwOnError: true,
  });
  return response.data.data as TOutput;
}

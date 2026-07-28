import {
  toolApprovalsList,
  type ToolApprovalRequest,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export async function listToolApprovals(
  input: { agentId?: string; runId?: string } = {},
): Promise<ToolApprovalRequest[]> {
  configureBrowserApiClients();
  const response = await toolApprovalsList({
    query: input,
    throwOnError: true,
  });
  return response.data.data;
}

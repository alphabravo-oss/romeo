import {
  contentPolicyGet,
  contentPolicySimulate,
  contentPolicyUpdate,
  type ContentPolicyReport,
  type ContentPolicySimulation,
  type SimulateContentPolicyRequest,
  type UpdateContentPolicyRequest,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export type {
  ContentPolicyReport,
  ContentPolicySimulation,
  SimulateContentPolicyRequest,
  UpdateContentPolicyRequest,
};

export async function getContentPolicy(): Promise<ContentPolicyReport> {
  configureBrowserApiClients();
  const response = await contentPolicyGet({ throwOnError: true });
  return response.data.data;
}

export async function updateContentPolicy(
  input: UpdateContentPolicyRequest,
): Promise<ContentPolicyReport> {
  configureBrowserApiClients();
  const response = await contentPolicyUpdate({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function simulateContentPolicy(
  input: SimulateContentPolicyRequest,
): Promise<ContentPolicySimulation> {
  configureBrowserApiClients();
  const response = await contentPolicySimulate({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

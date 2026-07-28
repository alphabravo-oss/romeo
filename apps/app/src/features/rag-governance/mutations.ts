import {
  ragGovernanceApprovePolicyChangeRequest,
  ragGovernanceCreatePolicyChangeRequest,
  ragGovernanceRejectPolicyChangeRequest,
  ragGovernanceUpdatePolicy,
  type CreateRagPolicyChangeRequest,
  type ReviewRagPolicyChangeRequest,
  type UpdateRagPolicyRequest,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export async function updateRagPolicy(input: UpdateRagPolicyRequest) {
  configureBrowserApiClients();
  const response = await ragGovernanceUpdatePolicy({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function createRagPolicyChangeRequest(
  input: CreateRagPolicyChangeRequest,
) {
  configureBrowserApiClients();
  const response = await ragGovernanceCreatePolicyChangeRequest({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function approveRagPolicyChangeRequest(
  requestId: string,
  input: ReviewRagPolicyChangeRequest,
) {
  configureBrowserApiClients();
  const response = await ragGovernanceApprovePolicyChangeRequest({
    path: { requestId },
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function rejectRagPolicyChangeRequest(
  requestId: string,
  input: ReviewRagPolicyChangeRequest,
) {
  configureBrowserApiClients();
  const response = await ragGovernanceRejectPolicyChangeRequest({
    path: { requestId },
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

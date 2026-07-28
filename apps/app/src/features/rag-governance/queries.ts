import {
  ragGovernanceGetPolicy,
  ragGovernanceGetPolicyChangeRequest,
  ragGovernanceGetPosture,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export async function getRagPolicy() {
  configureBrowserApiClients();
  const response = await ragGovernanceGetPolicy({ throwOnError: true });
  return response.data.data;
}

export async function getRagPosture() {
  configureBrowserApiClients();
  const response = await ragGovernanceGetPosture({ throwOnError: true });
  return response.data.data;
}

export async function getRagPolicyChangeRequest() {
  configureBrowserApiClients();
  const response = await ragGovernanceGetPolicyChangeRequest({
    throwOnError: true,
  });
  return response.data.data;
}

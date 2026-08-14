import {
  adminInsightsSimulateAbuseControls,
  adminInsightsUpdateAbuseControls,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

import type {
  SimulateAbuseControlPolicyRequest,
  UpdateAbuseControlPolicyRequest,
} from "./types";

export async function updateAbuseControls(
  input: UpdateAbuseControlPolicyRequest,
) {
  configureBrowserApiClients();
  const response = await adminInsightsUpdateAbuseControls({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function simulateAbuseControls(
  input: SimulateAbuseControlPolicyRequest,
) {
  configureBrowserApiClients();
  const response = await adminInsightsSimulateAbuseControls({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

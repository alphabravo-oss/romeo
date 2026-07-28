import { adminInsightsUpdateAbuseControls } from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

import type { UpdateAbuseControlPolicyRequest } from "./types";

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

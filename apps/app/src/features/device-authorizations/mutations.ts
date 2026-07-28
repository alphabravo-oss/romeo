import {
  deviceAuthorizationsCreate,
  deviceAuthorizationsRevoke,
  type CreateDeviceAuthorizationRequest,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export async function createDeviceAuthorization(
  input: CreateDeviceAuthorizationRequest,
) {
  configureBrowserApiClients();
  const response = await deviceAuthorizationsCreate({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function revokeDeviceAuthorization(deviceAuthorizationId: string) {
  configureBrowserApiClients();
  const response = await deviceAuthorizationsRevoke({
    path: { deviceAuthorizationId },
    throwOnError: true,
  });
  return response.data.data;
}

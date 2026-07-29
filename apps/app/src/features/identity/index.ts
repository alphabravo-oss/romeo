import {
  identityGetCurrentPrincipal,
  identityUpdateCurrentProfile,
  sessionsRevokeCurrent,
  type AuthSubject,
  type BootstrapResponse,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export type { AuthSubject };

export async function getBootstrap(): Promise<BootstrapResponse> {
  configureBrowserApiClients();
  const response = await identityGetCurrentPrincipal({ throwOnError: true });
  return response.data;
}

export async function updateMyProfile(input: {
  name?: string;
  email?: string;
}): Promise<void> {
  configureBrowserApiClients();
  await identityUpdateCurrentProfile({ body: input, throwOnError: true });
}

export async function logout(): Promise<void> {
  configureBrowserApiClients();
  await sessionsRevokeCurrent({ throwOnError: true });
}

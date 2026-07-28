import {
  delegatedOAuthRevokeConnection,
  delegatedOAuthStart,
  type StartDelegatedOAuthRequest,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export async function startDelegatedOAuth(input: StartDelegatedOAuthRequest) {
  configureBrowserApiClients();
  const response = await delegatedOAuthStart({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function revokeDelegatedOAuthConnection(connectionId: string) {
  configureBrowserApiClients();
  const response = await delegatedOAuthRevokeConnection({
    path: { connectionId },
    throwOnError: true,
  });
  return response.data.data;
}

import {
  delegatedOAuthGetPosture,
  delegatedOAuthListConnections,
  delegatedOAuthListProviders,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export async function listDelegatedOAuthProviders() {
  configureBrowserApiClients();
  const response = await delegatedOAuthListProviders({ throwOnError: true });
  return response.data.data;
}

export async function listDelegatedOAuthConnections(workspaceId?: string) {
  configureBrowserApiClients();
  const response = await delegatedOAuthListConnections({
    ...(workspaceId === undefined ? {} : { query: { workspaceId } }),
    throwOnError: true,
  });
  return response.data.data;
}

export async function getDelegatedOauthPosture() {
  configureBrowserApiClients();
  const response = await delegatedOAuthGetPosture({ throwOnError: true });
  return response.data.data;
}

import {
  administrationListApiKeys,
  administrationListGroupMembers,
  administrationListGroups,
  administrationListServiceAccounts,
  administrationListUsers,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export async function listUsers() {
  configureBrowserApiClients();
  const response = await administrationListUsers({ throwOnError: true });
  return response.data.data;
}

export async function listGroups() {
  configureBrowserApiClients();
  const response = await administrationListGroups({ throwOnError: true });
  return response.data.data;
}

export async function listGroupMembers(groupId: string) {
  configureBrowserApiClients();
  const response = await administrationListGroupMembers({
    path: { groupId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function listApiKeys() {
  configureBrowserApiClients();
  const response = await administrationListApiKeys({ throwOnError: true });
  return response.data.data;
}

export async function listServiceAccounts() {
  configureBrowserApiClients();
  const response = await administrationListServiceAccounts({
    throwOnError: true,
  });
  return response.data.data;
}

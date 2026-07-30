import {
  administrationListApiKeys,
  administrationListGroupMembers,
  administrationListGroups,
  administrationListServiceAccounts,
  administrationListUsers,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export async function listUsers(options: {
  direction?: "asc" | "desc";
  limit: number;
  offset: number;
  query?: string;
  sort?: "email" | "name" | "role" | "status";
}) {
  configureBrowserApiClients();
  const response = await administrationListUsers({
    query: {
      ...(options.direction === undefined
        ? {}
        : { direction: options.direction }),
      limit: options.limit,
      offset: options.offset,
      ...(options.query === undefined ? {} : { q: options.query }),
      ...(options.sort === undefined ? {} : { sort: options.sort }),
    },
    throwOnError: true,
  });
  return response.data;
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

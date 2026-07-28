import {
  administrationAddGroupMember,
  administrationBulkDisableServiceAccounts,
  administrationBulkRevokeApiKeys,
  administrationCreateApiKey,
  administrationCreateGroup,
  administrationCreateServiceAccount,
  administrationCreateServiceAccountApiKey,
  administrationDirectorySync,
  administrationDisableServiceAccount,
  administrationDisableUser,
  administrationRemoveGroupMember,
  administrationRevokeApiKey,
  administrationSetUserLocalPassword,
  administrationUpdateUserRole,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

import type { ApiKeyScope, DirectorySyncRequest, UserRole } from "./types";

export async function disableUser(userId: string) {
  configureBrowserApiClients();
  const response = await administrationDisableUser({
    path: { userId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function updateUserRole(input: {
  userId: string;
  role: UserRole;
}) {
  configureBrowserApiClients();
  const response = await administrationUpdateUserRole({
    path: { userId: input.userId },
    body: { confirmUserId: input.userId, role: input.role },
    throwOnError: true,
  });
  return response.data.data;
}

export async function setUserPassword(input: {
  userId: string;
  newPassword: string;
}): Promise<void> {
  configureBrowserApiClients();
  await administrationSetUserLocalPassword({
    path: { userId: input.userId },
    body: { confirmUserId: input.userId, newPassword: input.newPassword },
    throwOnError: true,
  });
}

export async function triggerDirectorySync(input: DirectorySyncRequest) {
  configureBrowserApiClients();
  const response = await administrationDirectorySync({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function createGroup(input: { name: string; slug?: string }) {
  configureBrowserApiClients();
  const body = {
    name: input.name,
    ...(input.slug?.trim() ? { slug: input.slug.trim() } : {}),
  };
  const response = await administrationCreateGroup({
    body,
    throwOnError: true,
  });
  return response.data.data;
}

export async function addGroupMember(input: {
  groupId: string;
  userId: string;
}) {
  configureBrowserApiClients();
  const response = await administrationAddGroupMember({
    path: { groupId: input.groupId },
    body: { userId: input.userId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function removeGroupMember(input: {
  groupId: string;
  userId: string;
}) {
  configureBrowserApiClients();
  const response = await administrationRemoveGroupMember({
    path: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function createApiKey(input: {
  name: string;
  scopes: ApiKeyScope[];
}) {
  configureBrowserApiClients();
  const response = await administrationCreateApiKey({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function revokeApiKey(apiKeyId: string) {
  configureBrowserApiClients();
  const response = await administrationRevokeApiKey({
    path: { apiKeyId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function bulkRevokeApiKeys(apiKeyIds: string[]) {
  configureBrowserApiClients();
  const response = await administrationBulkRevokeApiKeys({
    body: { apiKeyIds },
    throwOnError: true,
  });
  return response.data.data;
}

export async function createServiceAccount(input: {
  name: string;
  scopes: ApiKeyScope[];
}) {
  configureBrowserApiClients();
  const response = await administrationCreateServiceAccount({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function createServiceAccountApiKey(input: {
  serviceAccountId: string;
  name: string;
  scopes: ApiKeyScope[];
}) {
  configureBrowserApiClients();
  const response = await administrationCreateServiceAccountApiKey({
    path: { serviceAccountId: input.serviceAccountId },
    body: { name: input.name, scopes: input.scopes },
    throwOnError: true,
  });
  return response.data.data;
}

export async function disableServiceAccount(serviceAccountId: string) {
  configureBrowserApiClients();
  const response = await administrationDisableServiceAccount({
    path: { serviceAccountId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function bulkDisableServiceAccounts(serviceAccountIds: string[]) {
  configureBrowserApiClients();
  const response = await administrationBulkDisableServiceAccounts({
    body: { serviceAccountIds },
    throwOnError: true,
  });
  return response.data.data;
}

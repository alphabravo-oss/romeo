import type {
  ApiKeySummary,
  ServiceAccount,
} from "@romeo/api-client/generated/sdk";
import type { QueryClient, QueryKey } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import {
  invalidateCachedResourceExactly,
  serverMutationOptions,
} from "../../lib/server-mutation-options";
import {
  bulkDisableServiceAccounts,
  bulkRevokeApiKeys,
  createApiKey,
  createServiceAccount,
  createServiceAccountApiKey,
  disableServiceAccount,
  revokeApiKey,
} from "./mutations";

type CachedList<T> = T[] | undefined;

function snapshotList<T>(
  client: QueryClient,
  queryKey: QueryKey,
): CachedList<T> {
  return client.getQueryData<T[]>(queryKey);
}

function restoreList<T>(
  client: QueryClient,
  queryKey: QueryKey,
  snapshot: CachedList<T>,
): void {
  if (snapshot === undefined) client.removeQueries({ exact: true, queryKey });
  else client.setQueryData(queryKey, snapshot);
}

function upsertById<T extends { id: string }>(
  client: QueryClient,
  queryKey: QueryKey,
  item: T,
): void {
  client.setQueryData<T[]>(queryKey, (current) => {
    if (current === undefined) return undefined;
    const index = current.findIndex((entry) => entry.id === item.id);
    if (index === -1) return [...current, item];
    return current.map((entry) => (entry.id === item.id ? item : entry));
  });
}

function markById<T extends { id: string }>(
  client: QueryClient,
  queryKey: QueryKey,
  ids: ReadonlySet<string>,
  patch: (item: T) => T,
): void {
  client.setQueryData<T[]>(queryKey, (current) =>
    current?.map((item) => (ids.has(item.id) ? patch(item) : item)),
  );
}

function reconcileBulkResult<T extends { id: string }>(
  client: QueryClient,
  queryKey: QueryKey,
  snapshot: CachedList<T>,
  results: ReadonlyArray<{ id: string; status: "failure" | "success" }>,
  successPatch: (item: T) => T,
): void {
  if (snapshot === undefined) return;
  const resultById = new Map(results.map((result) => [result.id, result]));
  client.setQueryData<T[]>(queryKey, (current) => {
    if (current === undefined) return snapshot;
    const snapshotById = new Map(snapshot.map((item) => [item.id, item]));
    return current.map((item) => {
      const result = resultById.get(item.id);
      if (result?.status === "success") return successPatch(item);
      if (result?.status === "failure")
        return snapshotById.get(item.id) ?? item;
      return item;
    });
  });
}

const revokedNow = (item: ApiKeySummary): ApiKeySummary => ({
  ...item,
  revokedAt: new Date().toISOString(),
});
const disabledNow = (item: ServiceAccount): ServiceAccount => ({
  ...item,
  disabledAt: new Date().toISOString(),
});

export function createApiKeyMutationOptions() {
  return serverMutationOptions({
    resource: "apiKey.create",
    mutationFn: createApiKey,
    reconcile: async (client, created) => {
      upsertById(client, appQueryKeys.apiKeys(), created.apiKey);
      await invalidateCachedResourceExactly(client, appQueryKeys.tablePages());
    },
  });
}

export function revokeApiKeyMutationOptions() {
  const queryKey = appQueryKeys.apiKeys();
  return serverMutationOptions<
    Awaited<ReturnType<typeof revokeApiKey>>,
    Error,
    string,
    CachedList<ApiKeySummary>
  >({
    resource: "apiKey.revoke",
    mutationFn: revokeApiKey,
    optimistic: {
      snapshot: async (client) => {
        await client.cancelQueries({ exact: true, queryKey });
        return snapshotList<ApiKeySummary>(client, queryKey);
      },
      update: (client, apiKeyId) =>
        markById(client, queryKey, new Set([apiKeyId]), revokedNow),
      rollback: (client, snapshot) => restoreList(client, queryKey, snapshot),
    },
    reconcile: async (client, apiKey) => {
      upsertById(client, queryKey, apiKey);
      await invalidateCachedResourceExactly(client, appQueryKeys.tablePages());
    },
  });
}

export function bulkRevokeApiKeysMutationOptions() {
  const queryKey = appQueryKeys.apiKeys();
  return serverMutationOptions<
    Awaited<ReturnType<typeof bulkRevokeApiKeys>>,
    Error,
    string[],
    CachedList<ApiKeySummary>
  >({
    resource: "apiKey.bulkRevoke",
    mutationFn: bulkRevokeApiKeys,
    optimistic: {
      snapshot: async (client) => {
        await client.cancelQueries({ exact: true, queryKey });
        return snapshotList<ApiKeySummary>(client, queryKey);
      },
      update: (client, apiKeyIds) =>
        markById(client, queryKey, new Set(apiKeyIds), revokedNow),
      rollback: (client, snapshot) => restoreList(client, queryKey, snapshot),
    },
    reconcile: async (client, result, _ids, snapshot) => {
      reconcileBulkResult(
        client,
        queryKey,
        snapshot,
        result.results,
        revokedNow,
      );
      await invalidateCachedResourceExactly(client, appQueryKeys.tablePages());
    },
    invalidations: () => [{ exact: true, queryKey }],
  });
}

export function createServiceAccountMutationOptions() {
  return serverMutationOptions({
    resource: "serviceAccount.create",
    mutationFn: createServiceAccount,
    reconcile: (client, account) =>
      upsertById(client, appQueryKeys.serviceAccounts(), account),
  });
}

export function createServiceAccountApiKeyMutationOptions() {
  return serverMutationOptions({
    resource: "serviceAccount.apiKey.create",
    mutationFn: createServiceAccountApiKey,
    reconcile: (client, created) =>
      upsertById(client, appQueryKeys.apiKeys(), created.apiKey),
  });
}

export function disableServiceAccountMutationOptions() {
  const queryKey = appQueryKeys.serviceAccounts();
  return serverMutationOptions<
    Awaited<ReturnType<typeof disableServiceAccount>>,
    Error,
    string,
    CachedList<ServiceAccount>
  >({
    resource: "serviceAccount.disable",
    mutationFn: disableServiceAccount,
    optimistic: {
      snapshot: async (client) => {
        await client.cancelQueries({ exact: true, queryKey });
        return snapshotList<ServiceAccount>(client, queryKey);
      },
      update: (client, serviceAccountId) =>
        markById(client, queryKey, new Set([serviceAccountId]), disabledNow),
      rollback: (client, snapshot) => restoreList(client, queryKey, snapshot),
    },
    reconcile: (client, account) => upsertById(client, queryKey, account),
  });
}

export function bulkDisableServiceAccountsMutationOptions() {
  const queryKey = appQueryKeys.serviceAccounts();
  return serverMutationOptions<
    Awaited<ReturnType<typeof bulkDisableServiceAccounts>>,
    Error,
    string[],
    CachedList<ServiceAccount>
  >({
    resource: "serviceAccount.bulkDisable",
    mutationFn: bulkDisableServiceAccounts,
    optimistic: {
      snapshot: async (client) => {
        await client.cancelQueries({ exact: true, queryKey });
        return snapshotList<ServiceAccount>(client, queryKey);
      },
      update: (client, serviceAccountIds) =>
        markById(client, queryKey, new Set(serviceAccountIds), disabledNow),
      rollback: (client, snapshot) => restoreList(client, queryKey, snapshot),
    },
    reconcile: (client, result, _ids, snapshot) =>
      reconcileBulkResult(
        client,
        queryKey,
        snapshot,
        result.results,
        disabledNow,
      ),
    invalidations: () => [{ exact: true, queryKey }],
  });
}

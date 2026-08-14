import type { QueryClient } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import { currentMutationSessionVersion } from "../../lib/mutation-session-boundary";
import {
  invalidateCachedResourceExactly,
  serverMutationOptions,
} from "../../lib/server-mutation-options";
import {
  createQuotaBucket,
  deleteQuotaBucket,
  updateQuotaBucket,
} from "./mutations";
import type {
  CreateQuotaBucketRequest,
  QuotaBucket,
  UpdateQuotaBucketRequest,
} from "./types";

type QuotaSnapshot = QuotaBucket[] | undefined;

async function withinCurrentSession<T>(operation: () => Promise<T>) {
  const sessionVersion = currentMutationSessionVersion();
  const result = await operation();
  if (sessionVersion !== currentMutationSessionVersion()) {
    throw new Error("The authentication session changed.");
  }
  return result;
}

function upsertQuota(client: QueryClient, quota: QuotaBucket): void {
  client.setQueryData<QuotaBucket[]>(appQueryKeys.quotas(), (current) => {
    if (current === undefined) return undefined;
    return current.some((entry) => entry.id === quota.id)
      ? current.map((entry) => (entry.id === quota.id ? quota : entry))
      : [...current, quota];
  });
}

async function snapshotQuotas(client: QueryClient): Promise<QuotaSnapshot> {
  const queryKey = appQueryKeys.quotas();
  await client.cancelQueries({ exact: true, queryKey });
  return client.getQueryData<QuotaBucket[]>(queryKey);
}

function restoreQuotas(client: QueryClient, snapshot: QuotaSnapshot): void {
  const queryKey = appQueryKeys.quotas();
  if (snapshot === undefined) client.removeQueries({ exact: true, queryKey });
  else client.setQueryData(queryKey, snapshot);
}

function removeQuota(client: QueryClient, quotaBucketId: string): void {
  client.setQueryData<QuotaBucket[]>(appQueryKeys.quotas(), (current) =>
    current?.filter((quota) => quota.id !== quotaBucketId),
  );
}

async function reconcileQuotaAudit(client: QueryClient): Promise<void> {
  await invalidateCachedResourceExactly(client, appQueryKeys.auditLogs());
}

const quotaInvalidations = () => [
  { exact: true as const, queryKey: appQueryKeys.quotas() },
  { exact: true as const, queryKey: appQueryKeys.usageAlerts() },
];

export function createQuotaBucketMutationOptions() {
  return serverMutationOptions({
    resource: "quota.create",
    mutationFn: (input: CreateQuotaBucketRequest) =>
      withinCurrentSession(() => createQuotaBucket(input)),
    reconcile: async (client, quota) => {
      upsertQuota(client, quota);
      await reconcileQuotaAudit(client);
    },
    invalidations: quotaInvalidations,
  });
}

export interface UpdateQuotaBucketInput {
  quotaBucketId: string;
  input: UpdateQuotaBucketRequest;
}

export function updateQuotaBucketMutationOptions() {
  return serverMutationOptions<
    QuotaBucket,
    Error,
    UpdateQuotaBucketInput,
    QuotaSnapshot
  >({
    resource: "quota.update",
    mutationFn: ({ quotaBucketId, input }) =>
      withinCurrentSession(() => updateQuotaBucket(quotaBucketId, input)),
    optimistic: {
      snapshot: snapshotQuotas,
      update: (client, { quotaBucketId, input }) => {
        client.setQueryData<QuotaBucket[]>(appQueryKeys.quotas(), (current) =>
          current?.map((quota) =>
            quota.id === quotaBucketId
              ? {
                  ...quota,
                  limit: input.limit ?? quota.limit,
                  resetInterval: input.resetInterval ?? quota.resetInterval,
                  used: input.resetUsage === true ? 0 : quota.used,
                }
              : quota,
          ),
        );
      },
      rollback: restoreQuotas,
    },
    reconcile: async (client, quota) => {
      upsertQuota(client, quota);
      await reconcileQuotaAudit(client);
    },
    invalidations: quotaInvalidations,
  });
}

export function deleteQuotaBucketMutationOptions() {
  return serverMutationOptions<QuotaBucket, Error, string, QuotaSnapshot>({
    resource: "quota.delete",
    mutationFn: (quotaBucketId) =>
      withinCurrentSession(() => deleteQuotaBucket(quotaBucketId)),
    optimistic: {
      snapshot: snapshotQuotas,
      update: removeQuota,
      rollback: restoreQuotas,
    },
    reconcile: async (client, quota) => {
      removeQuota(client, quota.id);
      await reconcileQuotaAudit(client);
    },
    invalidations: quotaInvalidations,
  });
}

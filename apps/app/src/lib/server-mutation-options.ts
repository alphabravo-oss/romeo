import {
  mutationOptions,
  type MutationFunction,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";

import { assertMutationNetworkReady } from "./connectivity";
import { currentMutationSessionVersion } from "./mutation-session-boundary";

export interface ExactMutationInvalidation {
  exact: true;
  queryKey: QueryKey;
}

export interface ResourceMutationPolicy<
  TData,
  TError,
  TVariables,
  TSnapshot = undefined,
> {
  /** Remove settled mutation data as soon as its observer resets. */
  ephemeral?: boolean;
  mutationFn: MutationFunction<TData, TVariables>;
  resource: string;
  optimistic?: {
    snapshot: (
      client: QueryClient,
      variables: TVariables,
    ) => Promise<TSnapshot> | TSnapshot;
    update: (
      client: QueryClient,
      variables: TVariables,
    ) => Promise<void> | void;
    rollback: (
      client: QueryClient,
      snapshot: TSnapshot,
      variables: TVariables,
    ) => Promise<void> | void;
  };
  reconcile?: (
    client: QueryClient,
    data: TData,
    variables: TVariables,
    snapshot: TSnapshot | undefined,
  ) => Promise<void> | void;
  reconcileError?: (
    client: QueryClient,
    error: TError,
    variables: TVariables,
    snapshot: TSnapshot | undefined,
  ) => Promise<void> | void;
  invalidations?: (
    data: TData,
    variables: TVariables,
  ) => readonly ExactMutationInvalidation[];
}

interface ManagedMutationContext<TSnapshot> {
  sessionVersion: number;
  snapshot: TSnapshot | undefined;
}

/**
 * Closed lifecycle for server writes. Callers choose a feature factory; they
 * cannot replace retry, network, optimistic, rollback, or invalidation policy.
 */
export function serverMutationOptions<
  TData,
  TError = Error,
  TVariables = void,
  TSnapshot = undefined,
>(policy: ResourceMutationPolicy<TData, TError, TVariables, TSnapshot>) {
  return mutationOptions<
    TData,
    TError,
    TVariables,
    ManagedMutationContext<TSnapshot>
  >({
    ...(policy.ephemeral ? { gcTime: 0 } : {}),
    meta: {
      mutationPolicy: policy.resource,
      ...(policy.ephemeral ? { ephemeral: true } : {}),
    },
    mutationFn: async (variables, context) => {
      assertMutationNetworkReady();
      return policy.mutationFn(variables, context);
    },
    networkMode: "always",
    retry: false,
    onMutate: async (variables, context) => {
      assertMutationNetworkReady();
      const sessionVersion = currentMutationSessionVersion();
      const snapshot = await policy.optimistic?.snapshot(
        context.client,
        variables,
      );
      if (sessionVersion !== currentMutationSessionVersion()) {
        return { sessionVersion, snapshot };
      }
      await policy.optimistic?.update(context.client, variables);
      return {
        sessionVersion,
        snapshot,
      };
    },
    onError: async (error, variables, mutationContext, context) => {
      if (
        mutationContext === undefined ||
        mutationContext.sessionVersion !== currentMutationSessionVersion()
      ) {
        return;
      }
      if (policy.optimistic !== undefined) {
        await policy.optimistic.rollback(
          context.client,
          mutationContext.snapshot as TSnapshot,
          variables,
        );
      }
      await policy.reconcileError?.(
        context.client,
        error,
        variables,
        mutationContext.snapshot,
      );
    },
    onSuccess: async (data, variables, mutationContext, context) => {
      if (mutationContext.sessionVersion !== currentMutationSessionVersion()) {
        return;
      }
      await policy.reconcile?.(
        context.client,
        data,
        variables,
        mutationContext.snapshot,
      );
      await invalidateExactQueries(
        context.client,
        policy.invalidations?.(data, variables) ?? [],
      );
    },
  });
}

export async function invalidateExactQueries(
  client: QueryClient,
  invalidations: readonly ExactMutationInvalidation[],
): Promise<void> {
  await Promise.all(
    invalidations.map(({ queryKey }) =>
      client.invalidateQueries({ exact: true, queryKey }),
    ),
  );
}

/**
 * Invalidates every currently cached variant of a server resource by its
 * concrete key. Use this when one write changes all filtered/cursor variants;
 * callers retain exact invalidation semantics without a root/prefix refresh.
 */
export async function invalidateCachedResourceExactly(
  client: QueryClient,
  resourceKey: QueryKey,
): Promise<void> {
  await invalidateExactQueries(
    client,
    client
      .getQueryCache()
      .findAll({ queryKey: resourceKey })
      .map((query) => ({ exact: true, queryKey: query.queryKey })),
  );
}

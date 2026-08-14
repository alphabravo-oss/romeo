import { MutationObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  completeMutationNetworkRevalidation,
  markMutationNetworkOffline,
} from "./connectivity";
import { advanceMutationSessionBoundary } from "./mutation-session-boundary";
import { createRomeoQueryClient } from "./query-client";
import { clearRouteDataForLogout } from "./route-intent";
import { serverMutationOptions } from "./server-mutation-options";

const itemKey = ["test-resource", "item", "item-1"] as const;
const relatedKey = ["test-resource", "related", "item-1"] as const;
const relatedChildKey = [
  "test-resource",
  "related",
  "item-1",
  "child",
] as const;

describe("server mutation policy", () => {
  beforeEach(() => {
    completeMutationNetworkRevalidation();
    advanceMutationSessionBoundary();
  });

  it("applies optimistic state, reconciles success, and invalidates exact dependencies", async () => {
    const client = createRomeoQueryClient();
    client.setQueryData(itemKey, { value: "before" });
    client.setQueryData(relatedKey, { value: "related" });
    client.setQueryData(relatedChildKey, { value: "child" });
    const mutationFn = vi.fn(async ({ value }: { value: string }) => ({
      value: `${value}-server`,
    }));
    const observer = new MutationObserver(
      client,
      serverMutationOptions<
        { value: string },
        Error,
        { value: string },
        { value: string } | undefined
      >({
        resource: "testResource.update",
        mutationFn,
        optimistic: {
          snapshot: (queryClient) =>
            queryClient.getQueryData<{ value: string }>(itemKey),
          update: (queryClient, variables) => {
            queryClient.setQueryData(itemKey, variables);
          },
          rollback: (queryClient, snapshot) => {
            queryClient.setQueryData(itemKey, snapshot);
          },
        },
        reconcile: (queryClient, result) => {
          queryClient.setQueryData(itemKey, result);
        },
        invalidations: () => [{ exact: true, queryKey: relatedKey }],
      }),
    );

    await expect(observer.mutate({ value: "optimistic" })).resolves.toEqual({
      value: "optimistic-server",
    });

    expect(mutationFn).toHaveBeenCalledOnce();
    expect(client.getQueryData(itemKey)).toEqual({
      value: "optimistic-server",
    });
    expect(client.getQueryState(relatedKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(relatedChildKey)?.isInvalidated).toBe(false);
  });

  it.each(["version_conflict", "unauthorized"])(
    "rolls back optimistic state after %s failure",
    async (code) => {
      const client = createRomeoQueryClient();
      client.setQueryData(itemKey, { value: "before" });
      const observer = new MutationObserver(
        client,
        serverMutationOptions<
          never,
          Error,
          { value: string },
          { value: string }
        >({
          resource: "testResource.update",
          mutationFn: () => Promise.reject(new Error(code)),
          optimistic: {
            snapshot: (queryClient) =>
              queryClient.getQueryData<{ value: string }>(itemKey)!,
            update: (queryClient, variables) => {
              queryClient.setQueryData(itemKey, variables);
            },
            rollback: (queryClient, snapshot) => {
              queryClient.setQueryData(itemKey, snapshot);
            },
          },
        }),
      );

      await expect(observer.mutate({ value: "optimistic" })).rejects.toThrow(
        code,
      );
      expect(client.getQueryData(itemKey)).toEqual({ value: "before" });
    },
  );

  it("reconciles an expected failure only inside its originating session", async () => {
    const client = createRomeoQueryClient();
    const reconcileError = vi.fn();
    let rejectMutation!: (error: Error) => void;
    const observer = new MutationObserver(
      client,
      serverMutationOptions<never, Error, void>({
        resource: "testResource.expectedFailure",
        mutationFn: () =>
          new Promise<never>((_resolve, reject) => {
            rejectMutation = reject;
          }),
        reconcileError,
      }),
    );
    const pending = observer.mutate();
    await vi.waitFor(() => expect(rejectMutation).toBeTypeOf("function"));

    await clearRouteDataForLogout(client);
    rejectMutation(new Error("approval_required"));

    await expect(pending).rejects.toThrow("approval_required");
    expect(reconcileError).not.toHaveBeenCalled();
  });

  it("executes no mutation and creates no paused entry while offline", async () => {
    markMutationNetworkOffline();
    const client = createRomeoQueryClient();
    const mutationFn = vi.fn(() => Promise.resolve("saved"));
    const observer = new MutationObserver(
      client,
      serverMutationOptions({
        resource: "testResource.update",
        mutationFn,
      }),
    );

    await expect(observer.mutate(undefined)).rejects.toMatchObject({
      code: "mutation_network_blocked",
      gate: "offline",
    });
    expect(mutationFn).not.toHaveBeenCalled();
    expect(
      client
        .getMutationCache()
        .getAll()
        .some((entry) => entry.state.isPaused),
    ).toBe(false);
  });

  it("does not reconcile a response that completes after a session boundary", async () => {
    const client = createRomeoQueryClient();
    client.setQueryData(itemKey, { value: "before" });
    let resolveMutation!: (value: { value: string }) => void;
    const pending = new Promise<{ value: string }>((resolve) => {
      resolveMutation = resolve;
    });
    const observer = new MutationObserver(
      client,
      serverMutationOptions<
        { value: string },
        Error,
        { value: string },
        { value: string }
      >({
        resource: "testResource.update",
        mutationFn: () => pending,
        optimistic: {
          snapshot: (queryClient) =>
            queryClient.getQueryData<{ value: string }>(itemKey)!,
          update: (queryClient, variables) => {
            queryClient.setQueryData(itemKey, variables);
          },
          rollback: (queryClient, snapshot) => {
            queryClient.setQueryData(itemKey, snapshot);
          },
        },
        reconcile: (queryClient, result) => {
          queryClient.setQueryData(itemKey, result);
        },
      }),
    );

    const mutation = observer.mutate({ value: "optimistic" });
    await vi.waitFor(() =>
      expect(client.getQueryData(itemKey)).toEqual({ value: "optimistic" }),
    );
    await clearRouteDataForLogout(client);
    resolveMutation({ value: "late-server-value" });

    await expect(mutation).resolves.toEqual({ value: "late-server-value" });
    expect(client.getQueryData(itemKey)).toBeUndefined();
  });
});

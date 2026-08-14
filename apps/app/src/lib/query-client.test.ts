import { dehydrate, hydrate } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { createRomeoQueryClient, routeDehydrateOptions } from "./query-client";
import * as appQueryKeys from "./app-query-keys";
import {
  beginMutationNetworkRevalidation,
  completeMutationNetworkRevalidation,
  markMutationNetworkOffline,
} from "./connectivity";

describe("request-isolated query hydration", () => {
  it("does not share cached subject data between request clients", async () => {
    const firstRequest = createRomeoQueryClient();
    const secondRequest = createRomeoQueryClient();
    const queryKey = [{ _id: "identityGetCurrentPrincipal" }] as const;

    await Promise.all([
      firstRequest.fetchQuery({
        queryKey,
        queryFn: () => Promise.resolve({ subject: { id: "subject-a" } }),
        meta: { ssr: true },
      }),
      secondRequest.fetchQuery({
        queryKey,
        queryFn: () => Promise.resolve({ subject: { id: "subject-b" } }),
        meta: { ssr: true },
      }),
    ]);

    expect(firstRequest.getQueryData(queryKey)).toEqual({
      subject: { id: "subject-a" },
    });
    expect(secondRequest.getQueryData(queryKey)).toEqual({
      subject: { id: "subject-b" },
    });
    firstRequest.clear();
    expect(secondRequest.getQueryData(queryKey)).toBeDefined();
  });

  it("hydrates approved fresh data without issuing a duplicate request", async () => {
    const request = vi.fn(() => Promise.resolve({ value: "prefetched" }));
    const queryKey = [{ _id: "providersListConnections" }] as const;
    const options = {
      queryKey,
      queryFn: request,
      meta: { ssr: true },
      staleTime: 10_000,
    } as const;
    const serverClient = createRomeoQueryClient();
    await serverClient.fetchQuery(options);

    const browserClient = createRomeoQueryClient();
    hydrate(browserClient, dehydrate(serverClient, routeDehydrateOptions));
    await browserClient.fetchQuery(options);

    expect(request).toHaveBeenCalledTimes(1);
    expect(browserClient.getQueryData(queryKey)).toEqual({
      value: "prefetched",
    });
  });

  it("excludes unapproved and failed query state from the document", async () => {
    const queryClient = createRomeoQueryClient();
    queryClient.setQueryData(["draft", "private"], "sensitive draft");
    queryClient.setQueryData(
      appQueryKeys.streamingMessage("chat-private", "message-private"),
      { content: "in-flight private answer" },
    );
    await queryClient
      .fetchQuery({
        queryKey: ["failed"],
        queryFn: () => Promise.reject(new Error("provider credential=secret")),
        meta: { ssr: true },
        retry: false,
      })
      .catch(() => undefined);

    const dehydrated = dehydrate(queryClient, routeDehydrateOptions);
    expect(dehydrated.queries).toHaveLength(0);
    expect(JSON.stringify(dehydrated)).not.toContain("sensitive draft");
    expect(JSON.stringify(dehydrated)).not.toContain(
      "in-flight private answer",
    );
    expect(JSON.stringify(dehydrated)).not.toContain("credential=secret");
  });
});

describe("offline mutation policy", () => {
  it("executes no fetch and creates no paused queue while offline", async () => {
    markMutationNetworkOffline();
    const queryClient = createRomeoQueryClient();
    const fetchMutation = vi.fn(() => Promise.resolve("saved"));
    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationFn: fetchMutation,
    });

    await expect(mutation.execute(undefined)).rejects.toMatchObject({
      code: "mutation_network_blocked",
      gate: "offline",
    });

    expect(fetchMutation).not.toHaveBeenCalled();
    expect(mutation.state.isPaused).toBe(false);
    expect(
      queryClient
        .getMutationCache()
        .getAll()
        .filter((entry) => entry.state.isPaused),
    ).toHaveLength(0);
    completeMutationNetworkRevalidation();
  });

  it("requires a new explicit retry after reconnect revalidation", async () => {
    const queryClient = createRomeoQueryClient();
    const fetchMutation = vi.fn(() => Promise.resolve("saved"));
    beginMutationNetworkRevalidation();

    const beforeValidation = queryClient
      .getMutationCache()
      .build(queryClient, { mutationFn: fetchMutation });
    await expect(beforeValidation.execute(undefined)).rejects.toMatchObject({
      gate: "revalidating",
    });
    expect(fetchMutation).not.toHaveBeenCalled();

    completeMutationNetworkRevalidation();
    const explicitRetry = queryClient
      .getMutationCache()
      .build(queryClient, { mutationFn: fetchMutation });
    await expect(explicitRetry.execute(undefined)).resolves.toBe("saved");
    expect(fetchMutation).toHaveBeenCalledOnce();
  });
});

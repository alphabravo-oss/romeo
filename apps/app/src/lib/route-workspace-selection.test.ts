import type {
  BootstrapResponse,
  Chat,
} from "@romeo/api-client/generated/query";
import type { GeneratedQueryClient } from "@romeo/api-client/runtime/generated-query-client";
import { dehydrate, hydrate } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { routeChatMetadataQueryOptions } from "../features/chats/query-options";
import * as appQueryKeys from "./app-query-keys";
import { createRomeoQueryClient, routeDehydrateOptions } from "./query-client";
import { routerSessionQueryOptions } from "./router-runtime-data";
import {
  resolveAuthorizedRouteWorkspace,
  RouteWorkspaceSelectionError,
  routeWorkspaceSelectionQueryOptions,
} from "./route-workspace-selection";

const bootstrap: BootstrapResponse = {
  deployment: { tenancyMode: "multi" },
  organizations: [],
  subject: {
    apiKeyId: "never-serialize-api-key-id",
    groupIds: ["private-group"],
    id: "subject-a",
    isAdmin: false,
    orgId: "org-a",
    scopes: ["private:scope"],
    sessionId: "never-serialize-session-id",
    type: "user",
    workspaceIds: ["workspace-a", "workspace-b"],
  },
  workspaces: [
    {
      id: "workspace-a",
      name: "Workspace A",
      orgId: "org-a",
      slug: "workspace-a",
    },
    {
      id: "workspace-b",
      name: "Workspace B",
      orgId: "org-a",
      slug: "workspace-b",
    },
    {
      id: "workspace-other",
      name: "Other",
      orgId: "org-other",
      slug: "workspace-other",
    },
  ],
};

function chat(id: string, workspaceId: string): Chat {
  return {
    id,
    workspaceId,
    title: `Chat ${id}`,
  } as Chat;
}

function clientFor(input: {
  bootstrap?: BootstrapResponse;
  chat?: Chat;
  onGet?: (url: string, signal: AbortSignal | undefined) => void;
}): GeneratedQueryClient {
  return {
    get: vi.fn((options: { signal?: AbortSignal; url: string }) => {
      input.onGet?.(options.url, options.signal);
      if (options.url === "/me") {
        return Promise.resolve({ data: input.bootstrap ?? bootstrap });
      }
      if (options.url.includes("/chats/")) {
        if (input.chat === undefined) {
          return Promise.reject(
            Object.assign(new Error("credential=provider-secret"), {
              status: 404,
            }),
          );
        }
        return Promise.resolve({ data: { data: input.chat } });
      }
      return Promise.reject(new Error(`Unexpected URL ${options.url}`));
    }),
    getConfig: () => ({ baseUrl: "https://romeo.example/api/v1" }),
  } as unknown as GeneratedQueryClient;
}

function errorCode(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(RouteWorkspaceSelectionError);
    return (error as RouteWorkspaceSelectionError).code;
  }
  return undefined;
}

describe("authorized route workspace selection", () => {
  it("uses an authorized explicit workspace and derives one from chat metadata", () => {
    expect(
      resolveAuthorizedRouteWorkspace({
        bootstrap,
        chat: undefined,
        request: { workspaceId: "workspace-b" },
      }),
    ).toEqual({ source: "workspace", workspaceId: "workspace-b" });
    expect(
      resolveAuthorizedRouteWorkspace({
        bootstrap,
        chat: chat("chat-a", "workspace-a"),
        request: { chatId: "chat-a" },
      }),
    ).toEqual({
      chatId: "chat-a",
      source: "chat",
      workspaceId: "workspace-a",
    });
  });

  it("restores each authorized URL selection across Back and Forward", () => {
    const history = ["workspace-a", "workspace-b", "workspace-a"];
    expect(
      history.map(
        (workspaceId) =>
          resolveAuthorizedRouteWorkspace({
            bootstrap,
            chat: undefined,
            request: { workspaceId },
          }).workspaceId,
      ),
    ).toEqual(history);
  });

  it("rejects unauthorized, mismatched, and inaccessible chat selections", () => {
    expect(
      errorCode(() =>
        resolveAuthorizedRouteWorkspace({
          bootstrap,
          chat: undefined,
          request: { workspaceId: "workspace-other" },
        }),
      ),
    ).toBe("workspace_not_authorized");
    expect(
      errorCode(() =>
        resolveAuthorizedRouteWorkspace({
          bootstrap,
          chat: chat("chat-a", "workspace-a"),
          request: { chatId: "chat-a", workspaceId: "workspace-b" },
        }),
      ),
    ).toBe("chat_workspace_mismatch");
    expect(
      errorCode(() =>
        resolveAuthorizedRouteWorkspace({
          bootstrap,
          chat: chat("chat-other", "workspace-other"),
          request: { chatId: "chat-other" },
        }),
      ),
    ).toBe("chat_not_authorized");
  });

  it("maps a denied chat lookup to a stable privacy-safe route error", async () => {
    const client = clientFor({});
    const queryClient = createRomeoQueryClient();
    const request = queryClient.fetchQuery(
      routeWorkspaceSelectionQueryOptions(
        { chatId: "chat-denied" },
        queryClient,
        client,
      ),
    );

    await expect(request).rejects.toMatchObject({
      code: "chat_not_authorized",
      message: "The requested workspace or chat is unavailable.",
      status: 404,
    });
    await expect(request).rejects.not.toHaveProperty(
      "message",
      expect.stringContaining("provider-secret"),
    );
  });

  it("starts bootstrap and selected-chat authorization in parallel", async () => {
    const started: string[] = [];
    const client = clientFor({
      chat: chat("chat-a", "workspace-a"),
      onGet: (url) => started.push(url),
    });
    const queryClient = createRomeoQueryClient();
    const selection = queryClient.fetchQuery(
      routeWorkspaceSelectionQueryOptions(
        { chatId: "chat-a" },
        queryClient,
        client,
      ),
    );

    await vi.waitFor(() => expect(started).toHaveLength(2));
    expect(started).toContain("/me");
    expect(started.some((url) => url.includes("/chats/"))).toBe(true);
    await expect(selection).resolves.toMatchObject({
      workspaceId: "workspace-a",
    });
  });

  it("reuses the exact chat metadata cache without a duplicate request", async () => {
    const client = clientFor({ chat: chat("chat-a", "workspace-a") });
    const queryClient = createRomeoQueryClient();
    const selectionOptions = routeWorkspaceSelectionQueryOptions(
      { chatId: "chat-a" },
      queryClient,
      client,
    );
    await queryClient.fetchQuery(selectionOptions);
    await queryClient.fetchQuery(selectionOptions);
    await queryClient.fetchQuery(
      routeChatMetadataQueryOptions("chat-a", client),
    );

    const get = client.get as ReturnType<typeof vi.fn>;
    expect(
      get.mock.calls.filter(([options]) =>
        (options as { url: string }).url.includes("/chats/"),
      ),
    ).toHaveLength(1);
    expect(queryClient.getQueryData(appQueryKeys.chat("chat-a"))).toMatchObject(
      { id: "chat-a", workspaceId: "workspace-a" },
    );
  });

  it("deduplicates bootstrap across selection, session, and shell consumers", async () => {
    const client = clientFor({ chat: chat("chat-a", "workspace-a") });
    const queryClient = createRomeoQueryClient();
    await Promise.all([
      queryClient.fetchQuery(
        routeWorkspaceSelectionQueryOptions(
          { chatId: "chat-a" },
          queryClient,
          client,
        ),
      ),
      queryClient.fetchQuery(
        routerSessionQueryOptions("en", queryClient, client),
      ),
    ]);

    const get = client.get as ReturnType<typeof vi.fn>;
    expect(
      get.mock.calls.filter(
        ([options]) => (options as { url: string }).url === "/me",
      ),
    ).toHaveLength(1);
  });

  it("cancels nested authorization requests and never commits a selection", async () => {
    const signals = new Map<string, AbortSignal>();
    const client = {
      get: vi.fn((options: { signal?: AbortSignal; url: string }) => {
        if (options.signal !== undefined) {
          signals.set(options.url, options.signal);
        }
        if (options.url === "/me") {
          return Promise.resolve({ data: bootstrap });
        }
        return new Promise((_resolve, reject) => {
          const signal = options.signal;
          if (signal !== undefined) {
            signal.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          }
        });
      }),
      getConfig: () => ({ baseUrl: "https://romeo.example/api/v1" }),
    } as unknown as GeneratedQueryClient;
    const queryClient = createRomeoQueryClient();
    const options = routeWorkspaceSelectionQueryOptions(
      { chatId: "chat-a" },
      queryClient,
      client,
    );
    const pending = queryClient.fetchQuery(options);
    await vi.waitFor(() => expect(signals.size).toBe(2));

    await queryClient.cancelQueries({
      exact: true,
      queryKey: options.queryKey,
    });
    await expect(pending).rejects.toHaveProperty("message", "CancelledError");
    expect(signals.get("/chats/{chatId}")?.aborted).toBe(true);
    expect(signals.get("/me")?.aborted).toBe(false);
    expect(queryClient.getQueryData(options.queryKey)).toBeUndefined();
  });

  it("dehydrates only safe route selection/chat metadata per request", async () => {
    const first = createRomeoQueryClient();
    const second = createRomeoQueryClient();
    const secondBootstrap: BootstrapResponse = {
      ...bootstrap,
      subject: {
        ...bootstrap.subject,
        apiKeyId: "other-secret-key-id",
        id: "subject-b",
        orgId: "org-b",
        sessionId: "other-secret-session-id",
        workspaceIds: ["workspace-z"],
      },
      workspaces: [
        {
          id: "workspace-z",
          name: "Z",
          orgId: "org-b",
          slug: "workspace-z",
        },
      ],
    };

    await Promise.all([
      first.fetchQuery(
        routeWorkspaceSelectionQueryOptions(
          { chatId: "chat-a", workspaceId: "workspace-a" },
          first,
          clientFor({ chat: chat("chat-a", "workspace-a") }),
        ),
      ),
      second.fetchQuery(
        routeWorkspaceSelectionQueryOptions(
          { workspaceId: "workspace-z" },
          second,
          clientFor({ bootstrap: secondBootstrap }),
        ),
      ),
    ]);

    const firstDocument = JSON.stringify(
      dehydrate(first, routeDehydrateOptions),
    );
    const secondDocument = JSON.stringify(
      dehydrate(second, routeDehydrateOptions),
    );
    expect(firstDocument).toContain("workspace-a");
    expect(firstDocument).toContain("chat-a");
    expect(firstDocument).not.toContain("workspace-z");
    expect(secondDocument).toContain("workspace-z");
    expect(secondDocument).not.toContain("workspace-a");
    for (const document of [firstDocument, secondDocument]) {
      expect(document).not.toContain("never-serialize");
      expect(document).not.toContain("other-secret");
      expect(document).not.toContain("private:scope");
      expect(document).not.toContain("private-group");
    }

    const browser = createRomeoQueryClient();
    hydrate(browser, dehydrate(first, routeDehydrateOptions));
    const reloadClient = clientFor({ chat: chat("chat-a", "workspace-a") });
    await expect(
      browser.fetchQuery(
        routeWorkspaceSelectionQueryOptions(
          { chatId: "chat-a", workspaceId: "workspace-a" },
          browser,
          reloadClient,
        ),
      ),
    ).resolves.toMatchObject({ workspaceId: "workspace-a" });
    expect(reloadClient.get).not.toHaveBeenCalled();
  });
});

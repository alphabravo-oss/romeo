import { MutationObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as appQueryKeys from "../../lib/app-query-keys";
import {
  completeMutationNetworkRevalidation,
  markMutationNetworkOffline,
} from "../../lib/connectivity";
import { advanceMutationSessionBoundary } from "../../lib/mutation-session-boundary";
import { createRomeoQueryClient } from "../../lib/query-client";
import { clearRouteDataForLogout } from "../../lib/route-intent";
import {
  deleteWorkspaceContentMutationOptions,
  saveWorkspaceContentMutationOptions,
} from "./mutation-options";
import type { WorkspaceContentItem, WorkspaceContentPage } from "./types";

const mutationMocks = vi.hoisted(() => ({
  createWorkspaceContent: vi.fn(),
  deleteWorkspaceContent: vi.fn(),
  updateWorkspaceContent: vi.fn(),
}));

vi.mock("./mutations", () => mutationMocks);

function content(
  overrides: Partial<WorkspaceContentItem> = {},
): WorkspaceContentItem {
  return {
    body: "private body",
    createdAt: "2026-08-14T00:00:00.000Z",
    enabled: true,
    expired: false,
    id: "content-1",
    kind: "memory",
    ownerId: "user-1",
    pinned: false,
    scope: "personal",
    title: "Private memory",
    updatedAt: "2026-08-14T00:00:00.000Z",
    workspaceId: "workspace-1",
    ...overrides,
  };
}

function page(items: WorkspaceContentItem[]): WorkspaceContentPage {
  return {
    hasMore: false,
    items,
    limit: 25,
    offset: 0,
    total: items.length,
  };
}

const firstPageKey = appQueryKeys.personalContent("memories", "workspace-1", {
  page: 0,
  query: "",
});
const filteredPageKey = appQueryKeys.personalContent(
  "memories",
  "workspace-1",
  { page: 0, query: "private" },
);
const unrelatedKey = appQueryKeys.personalContent("notes", "workspace-1", {
  page: 0,
  query: "",
});

describe("workspace content mutation policies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completeMutationNetworkRevalidation();
    advanceMutationSessionBoundary();
  });

  it("rolls every optimistic content page back after conflict or denial", async () => {
    const client = createRomeoQueryClient();
    const before = content();
    const observer = new MutationObserver(
      client,
      saveWorkspaceContentMutationOptions(),
    );

    for (const error of ["version_conflict", "forbidden"]) {
      client.setQueryData(firstPageKey, page([before]));
      client.setQueryData(filteredPageKey, page([before]));
      client.setQueryData(unrelatedKey, page([]));
      let rejectUpdate!: (reason: Error) => void;
      mutationMocks.updateWorkspaceContent.mockReturnValueOnce(
        new Promise<WorkspaceContentItem>((_resolve, reject) => {
          rejectUpdate = reject;
        }),
      );
      const mutation = observer.mutate({
        operation: "update",
        kind: "memories",
        workspaceId: "workspace-1",
        contentId: before.id,
        input: { body: "optimistic private body", scope: "workspace" },
      });
      await vi.waitFor(() =>
        expect(
          client.getQueryData<WorkspaceContentPage>(firstPageKey)?.items[0],
        ).toMatchObject({
          body: "optimistic private body",
          scope: "workspace",
        }),
      );

      rejectUpdate(new Error(error));
      await expect(mutation).rejects.toThrow(error);
      expect(client.getQueryData(firstPageKey)).toEqual(page([before]));
      expect(client.getQueryData(filteredPageKey)).toEqual(page([before]));
      expect(client.getQueryState(firstPageKey)?.isInvalidated).toBe(false);
      expect(client.getQueryState(unrelatedKey)?.isInvalidated).toBe(false);
    }
  });

  it("removes content optimistically and invalidates only exact scoped pages", async () => {
    const client = createRomeoQueryClient();
    const removed = content();
    client.setQueryData(firstPageKey, page([removed]));
    client.setQueryData(filteredPageKey, page([removed]));
    client.setQueryData(unrelatedKey, page([content({ id: "note-1" })]));
    mutationMocks.deleteWorkspaceContent.mockResolvedValueOnce(removed);
    const observer = new MutationObserver(
      client,
      deleteWorkspaceContentMutationOptions(),
    );

    await observer.mutate({
      kind: "memories",
      workspaceId: "workspace-1",
      contentId: removed.id,
    });

    expect(client.getQueryData(firstPageKey)).toEqual(page([]));
    expect(client.getQueryData(filteredPageKey)).toEqual(page([]));
    expect(client.getQueryState(firstPageKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(filteredPageKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(unrelatedKey)?.isInvalidated).toBe(false);
  });

  it("keeps created personal content out of query and settled mutation caches", async () => {
    const client = createRomeoQueryClient();
    client.setQueryData(firstPageKey, page([]));
    const created = content({ body: "credential=must-not-persist" });
    mutationMocks.createWorkspaceContent.mockResolvedValueOnce(created);
    const observer = new MutationObserver(
      client,
      saveWorkspaceContentMutationOptions(),
    );

    await observer.mutate({
      operation: "create",
      kind: "memories",
      workspaceId: "workspace-1",
      input: {
        body: created.body,
        scope: "personal",
        title: created.title,
        workspaceId: "workspace-1",
      },
    });

    expect(client.getQueryState(firstPageKey)?.isInvalidated).toBe(true);
    expect(JSON.stringify(client.getQueryCache().getAll())).not.toContain(
      "must-not-persist",
    );
    observer.reset();
    await vi.waitFor(() =>
      expect(client.getMutationCache().getAll()).toHaveLength(0),
    );
  });

  it("executes no personal-content write while offline", async () => {
    const client = createRomeoQueryClient();
    markMutationNetworkOffline();
    const observer = new MutationObserver(
      client,
      deleteWorkspaceContentMutationOptions(),
    );

    await expect(
      observer.mutate({
        kind: "memories",
        workspaceId: "workspace-1",
        contentId: "content-1",
      }),
    ).rejects.toThrow(
      "Changes are unavailable until the secure connection is ready.",
    );
    expect(mutationMocks.deleteWorkspaceContent).not.toHaveBeenCalled();
  });

  it("rejects personal content arriving after logout without a cache commit", async () => {
    const client = createRomeoQueryClient();
    let resolveCreate: ((value: WorkspaceContentItem) => void) | undefined;
    mutationMocks.createWorkspaceContent.mockImplementationOnce(
      () =>
        new Promise<WorkspaceContentItem>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const observer = new MutationObserver(
      client,
      saveWorkspaceContentMutationOptions(),
    );
    const pending = observer.mutate({
      operation: "create",
      kind: "memories",
      workspaceId: "workspace-1",
      input: {
        body: "credential=late-response",
        scope: "personal",
        title: "Late",
        workspaceId: "workspace-1",
      },
    });
    await vi.waitFor(() => expect(resolveCreate).toBeDefined());

    await clearRouteDataForLogout(client);
    resolveCreate?.(content({ body: "credential=late-response" }));

    await expect(pending).rejects.toThrow(
      "The authentication session changed.",
    );
    expect(JSON.stringify(client.getQueryCache().getAll())).not.toContain(
      "late-response",
    );
    observer.reset();
  });
});

import { MutationObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiQueryKeys } from "../../lib/api-query-options";
import * as appQueryKeys from "../../lib/app-query-keys";
import {
  completeMutationNetworkRevalidation,
  markMutationNetworkOffline,
} from "../../lib/connectivity";
import { advanceMutationSessionBoundary } from "../../lib/mutation-session-boundary";
import { createRomeoQueryClient } from "../../lib/query-client";
import { clearRouteDataForLogout } from "../../lib/route-intent";
import type { Workspace, WorkspaceExportDocument } from "./types";
import {
  archiveWorkspaceMutationOptions,
  exportWorkspaceMutationOptions,
  updateWorkspaceDefaultAgentMutationOptions,
} from "./mutation-options";

const mutationMocks = vi.hoisted(() => ({
  archiveWorkspace: vi.fn(),
  updateWorkspaceDefaultAgent: vi.fn(),
}));
const queryMocks = vi.hoisted(() => ({ exportWorkspace: vi.fn() }));

vi.mock("./mutations", () => mutationMocks);
vi.mock("./queries", () => queryMocks);

const workspace = (defaultAgentId?: string): Workspace => ({
  id: "workspace-1",
  name: "Workspace",
  orgId: "org-1",
  slug: "workspace",
  ...(defaultAgentId === undefined ? {} : { defaultAgentId }),
});

const exportDocument = (): WorkspaceExportDocument => ({
  schema: "romeo.workspace-export.v1",
  orgId: "org-1",
  workspace: workspace(),
  counts: {
    agents: 0,
    chats: 0,
    dataConnectors: 0,
    knowledgeBases: 0,
    messages: 0,
    workflows: 0,
  },
  resources: {
    agents: [],
    chats: [],
    dataConnectors: [],
    knowledgeBases: [],
    workflows: [],
  },
  exportedAt: "2026-08-14T00:00:00.000Z",
});

describe("tenancy mutation policies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completeMutationNetworkRevalidation();
    advanceMutationSessionBoundary();
  });

  it("reconciles the exact workspace and bootstrap projection", async () => {
    const client = createRomeoQueryClient();
    const workspacesKey = appQueryKeys.workspaces();
    const bootstrapKey = apiQueryKeys.bootstrap();
    client.setQueryData(workspacesKey, [workspace()]);
    client.setQueryData(bootstrapKey as readonly unknown[], { data: {} });
    mutationMocks.updateWorkspaceDefaultAgent.mockResolvedValueOnce(
      workspace("agent-1"),
    );
    const observer = new MutationObserver(
      client,
      updateWorkspaceDefaultAgentMutationOptions(),
    );

    await observer.mutate({
      agentId: "agent-1",
      workspaceId: "workspace-1",
    });

    expect(
      client.getQueryData<Workspace[]>(workspacesKey)?.[0]?.defaultAgentId,
    ).toBe("agent-1");
    expect(client.getQueryState(workspacesKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(bootstrapKey)?.isInvalidated).toBe(true);
  });

  it("archives with exact workspace-scoped cache convergence", async () => {
    const client = createRomeoQueryClient();
    const workspacesKey = appQueryKeys.workspaces();
    const chatsKey = appQueryKeys.chats("workspace-1");
    const collaborationChatsKey = appQueryKeys.chats(
      "workspace-1",
      "collaboration",
    );
    const otherChatsKey = appQueryKeys.chats("workspace-2");
    const auditKey = appQueryKeys.auditLogs({ limit: 25 });
    const unrelated = appQueryKeys.apiKeys();
    const archived = {
      ...workspace(),
      archivedAt: "2026-08-14T01:00:00.000Z",
    };
    client.setQueryData(workspacesKey, [workspace()]);
    for (const queryKey of [
      chatsKey,
      collaborationChatsKey,
      otherChatsKey,
      auditKey,
      unrelated,
    ]) {
      client.setQueryData(queryKey, []);
    }
    mutationMocks.archiveWorkspace.mockResolvedValueOnce(archived);
    const observer = new MutationObserver(
      client,
      archiveWorkspaceMutationOptions(),
    );

    await observer.mutate("workspace-1");

    expect(client.getQueryData(workspacesKey)).toEqual([archived]);
    for (const queryKey of [
      workspacesKey,
      chatsKey,
      collaborationChatsKey,
      auditKey,
    ]) {
      expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
    }
    expect(client.getQueryState(otherChatsKey)?.isInvalidated).toBe(false);
    expect(client.getQueryState(unrelated)?.isInvalidated).toBe(false);
  });

  it("rolls archive state back after conflict or authorization failure", async () => {
    const client = createRomeoQueryClient();
    const queryKey = appQueryKeys.workspaces();
    const existing = workspace();
    const observer = new MutationObserver(
      client,
      archiveWorkspaceMutationOptions(),
    );

    for (const error of ["version_conflict", "forbidden"]) {
      client.setQueryData(queryKey, [existing]);
      mutationMocks.archiveWorkspace.mockRejectedValueOnce(new Error(error));
      await expect(observer.mutate("workspace-1")).rejects.toThrow(error);
      expect(client.getQueryData(queryKey)).toEqual([existing]);
      expect(client.getQueryState(queryKey)?.isInvalidated).toBe(false);
    }
  });

  it("keeps export data ephemeral and invalidates concrete audit views", async () => {
    const client = createRomeoQueryClient();
    const auditFirst = appQueryKeys.auditLogs({ limit: 25 });
    const auditFiltered = appQueryKeys.auditLogs({
      filters: [{ field: "action", operator: "eq", value: "workspace.export" }],
      limit: 50,
    });
    const unrelated = appQueryKeys.workspaces();
    for (const queryKey of [auditFirst, auditFiltered, unrelated]) {
      client.setQueryData(queryKey, []);
    }
    queryMocks.exportWorkspace.mockResolvedValueOnce(exportDocument());
    const observer = new MutationObserver(
      client,
      exportWorkspaceMutationOptions(),
    );

    await observer.mutate("workspace-1");

    expect(client.getQueryState(auditFirst)?.isInvalidated).toBe(true);
    expect(client.getQueryState(auditFiltered)?.isInvalidated).toBe(true);
    expect(client.getQueryState(unrelated)?.isInvalidated).toBe(false);
    expect(client.getQueryData(auditFirst)).toEqual([]);

    observer.reset();
    await vi.waitFor(() =>
      expect(client.getMutationCache().getAll()).toHaveLength(0),
    );
  });

  it("executes no workspace lifecycle write while offline", async () => {
    const client = createRomeoQueryClient();
    markMutationNetworkOffline();
    const observer = new MutationObserver(
      client,
      archiveWorkspaceMutationOptions(),
    );

    await expect(observer.mutate("workspace-1")).rejects.toThrow(
      "Changes are unavailable until the secure connection is ready.",
    );
    expect(mutationMocks.archiveWorkspace).not.toHaveBeenCalled();
  });

  it("rejects a late archive response after logout", async () => {
    const client = createRomeoQueryClient();
    const queryKey = appQueryKeys.workspaces();
    client.setQueryData(queryKey, [workspace()]);
    let resolveArchive: ((value: Workspace) => void) | undefined;
    mutationMocks.archiveWorkspace.mockImplementationOnce(
      () =>
        new Promise<Workspace>((resolve) => {
          resolveArchive = resolve;
        }),
    );
    const observer = new MutationObserver(
      client,
      archiveWorkspaceMutationOptions(),
    );
    const pending = observer.mutate("workspace-1");
    await vi.waitFor(() => expect(resolveArchive).toBeDefined());

    await clearRouteDataForLogout(client);
    resolveArchive?.({
      ...workspace(),
      archivedAt: "2026-08-14T01:00:00.000Z",
    });

    await expect(pending).rejects.toThrow(
      "The authentication session changed.",
    );
    expect(client.getQueryData(queryKey)).toBeUndefined();
  });
});

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
import type { DataConnector, DataConnectorSync } from "./types";
import {
  createDataConnectorMutationOptions,
  syncLocalDataConnectorMutationOptions,
} from "./mutation-options";

const mutationMocks = vi.hoisted(() => ({
  createDataConnector: vi.fn(),
  createLocalDataConnector: vi.fn(),
  syncDataConnector: vi.fn(),
  syncLocalDataConnector: vi.fn(),
}));

vi.mock("./mutations", () => mutationMocks);

const connector = (name = "Policies"): DataConnector => ({
  config: {},
  createdAt: "2026-08-14T00:00:00.000Z",
  createdBy: "user-1",
  id: "connector-1",
  knowledgeBaseId: "kb-1",
  name,
  orgId: "org-1",
  status: "active",
  type: "local_import",
  updatedAt: "2026-08-14T00:00:00.000Z",
  workspaceId: "workspace-1",
});

const sync = (): DataConnectorSync => ({
  completedAt: "2026-08-14T00:01:00.000Z",
  connectorId: "connector-1",
  createdBy: "user-1",
  id: "sync-1",
  itemCount: 1,
  knowledgeBaseId: "kb-1",
  orgId: "org-1",
  sourceIds: ["source-1"],
  startedAt: "2026-08-14T00:00:00.000Z",
  status: "completed",
  summary: {},
  workspaceId: "workspace-1",
});

describe("data connector mutation policies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completeMutationNetworkRevalidation();
    advanceMutationSessionBoundary();
  });

  it("reconciles creation only into its workspace and exact audit views", async () => {
    const client = createRomeoQueryClient();
    const workspaceKey = appQueryKeys.dataConnectors("workspace-1");
    const otherWorkspaceKey = appQueryKeys.dataConnectors("workspace-2");
    const auditFirst = appQueryKeys.auditLogs({ limit: 25 });
    const auditNext = appQueryKeys.auditLogs({ cursor: "next", limit: 25 });
    client.setQueryData(workspaceKey, []);
    client.setQueryData(otherWorkspaceKey, []);
    client.setQueryData(auditFirst, []);
    client.setQueryData(auditNext, []);
    mutationMocks.createDataConnector.mockResolvedValueOnce(connector());
    const observer = new MutationObserver(
      client,
      createDataConnectorMutationOptions(),
    );

    await observer.mutate({
      knowledgeBaseId: "kb-1",
      name: "Policies",
      type: "local_import",
      workspaceId: "workspace-1",
    });

    expect(client.getQueryData(workspaceKey)).toEqual([connector()]);
    expect(client.getQueryState(workspaceKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherWorkspaceKey)?.isInvalidated).toBe(false);
    expect(client.getQueryState(auditFirst)?.isInvalidated).toBe(true);
    expect(client.getQueryState(auditNext)?.isInvalidated).toBe(true);
  });

  it("converges local import projections without retaining raw content", async () => {
    const client = createRomeoQueryClient();
    const keys = [
      appQueryKeys.dataConnectorSyncs("connector-1"),
      appQueryKeys.knowledgeSources("kb-1"),
      appQueryKeys.dataConnectors("workspace-1"),
      appQueryKeys.usageEvents("24h"),
      appQueryKeys.usageEvents("30d"),
      appQueryKeys.usageSummary(),
      appQueryKeys.usageAlerts(),
      appQueryKeys.auditLogs({ limit: 25 }),
    ];
    for (const key of keys) client.setQueryData(key, []);
    mutationMocks.syncLocalDataConnector.mockResolvedValueOnce(sync());
    const observer = new MutationObserver(
      client,
      syncLocalDataConnectorMutationOptions(),
    );

    await observer.mutate({
      connectorId: "connector-1",
      content: "PRIVATE_IMPORT_CONTENT",
      fileName: "policies.md",
      mimeType: "text/markdown",
    });

    expect(client.getQueryData(keys[0]!)).toEqual([sync()]);
    for (const key of keys) {
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    }
    expect(JSON.stringify(client.getQueryCache().getAll())).not.toContain(
      "PRIVATE_IMPORT_CONTENT",
    );
    observer.reset();
    await vi.waitFor(() =>
      expect(client.getMutationCache().getAll()).toHaveLength(0),
    );
  });

  it("leaves sync projections unchanged after a conflict", async () => {
    const client = createRomeoQueryClient();
    const key = appQueryKeys.dataConnectorSyncs("connector-1");
    client.setQueryData(key, [sync()]);
    mutationMocks.syncLocalDataConnector.mockRejectedValueOnce(
      new Error("conflict"),
    );
    const observer = new MutationObserver(
      client,
      syncLocalDataConnectorMutationOptions(),
    );

    await expect(
      observer.mutate({
        connectorId: "connector-1",
        content: "new content",
        fileName: "policies.md",
        mimeType: "text/markdown",
      }),
    ).rejects.toThrow("conflict");
    expect(client.getQueryData(key)).toEqual([sync()]);
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  });

  it("does not commit a sync that resolves after logout", async () => {
    const client = createRomeoQueryClient();
    let resolveSync!: (value: DataConnectorSync) => void;
    mutationMocks.syncLocalDataConnector.mockReturnValueOnce(
      new Promise<DataConnectorSync>((resolve) => {
        resolveSync = resolve;
      }),
    );
    const observer = new MutationObserver(
      client,
      syncLocalDataConnectorMutationOptions(),
    );
    const pending = observer.mutate({
      connectorId: "connector-1",
      content: "content",
      fileName: "policies.md",
      mimeType: "text/markdown",
    });
    await vi.waitFor(() =>
      expect(mutationMocks.syncLocalDataConnector).toHaveBeenCalled(),
    );

    await clearRouteDataForLogout(client);
    const key = appQueryKeys.dataConnectorSyncs("connector-1");
    client.setQueryData(key, []);
    resolveSync(sync());
    await pending;

    expect(client.getQueryData(key)).toEqual([]);
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  });

  it("executes no import while offline", async () => {
    const client = createRomeoQueryClient();
    const observer = new MutationObserver(
      client,
      syncLocalDataConnectorMutationOptions(),
    );
    markMutationNetworkOffline();

    await expect(
      observer.mutate({
        connectorId: "connector-1",
        content: "content",
        fileName: "policies.md",
        mimeType: "text/markdown",
      }),
    ).rejects.toMatchObject({ code: "mutation_network_blocked" });
    expect(mutationMocks.syncLocalDataConnector).not.toHaveBeenCalled();
  });
});

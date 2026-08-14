import { MutationObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiQueryKeys } from "../../lib/api-query-options";
import * as appQueryKeys from "../../lib/app-query-keys";
import { completeMutationNetworkRevalidation } from "../../lib/connectivity";
import { advanceMutationSessionBoundary } from "../../lib/mutation-session-boundary";
import { createRomeoQueryClient } from "../../lib/query-client";
import { clearRouteDataForLogout } from "../../lib/route-intent";
import type { Agent, AgentKnowledgeBinding } from "./types";
import {
  createAgentMutationOptions,
  shareAgentAccessMutationOptions,
  updateAgentMutationOptions,
  updateAgentKnowledgeBindingMutationOptions,
} from "./mutation-options";

const mutationMocks = vi.hoisted(() => ({
  cloneAgent: vi.fn(),
  createAgent: vi.fn(),
  deleteAgent: vi.fn(),
  exportAgentDefinition: vi.fn(),
  importAgentDefinition: vi.fn(),
  publishAgent: vi.fn(),
  revokeAgentGrant: vi.fn(),
  rollbackAgentVersion: vi.fn(),
  shareAgent: vi.fn(),
  shareAgentAccess: vi.fn(),
  updateAgent: vi.fn(),
  updateAgentKnowledgeBinding: vi.fn(),
  updateManagedModelCustomizationPolicy: vi.fn(),
}));
const queryMocks = vi.hoisted(() => ({ diffAgentVersions: vi.fn() }));

vi.mock("./mutations", () => mutationMocks);
vi.mock("./queries", () => queryMocks);

const agent = (name: string): Agent => ({
  baseModelId: "model-1",
  createdBy: "user-1",
  id: "agent-1",
  memoryPolicy: { mode: "disabled" },
  name,
  orgId: "org-1",
  parameters: {},
  safetySettings: {},
  systemPrompt: "Be useful.",
  updatedAt: "2026-08-14T00:00:00.000Z",
  workspaceId: "workspace-1",
});

const binding = (enabled: boolean): AgentKnowledgeBinding => ({
  agentId: "agent-1",
  createdAt: "2026-08-14T00:00:00.000Z",
  enabled,
  id: "binding-1",
  knowledgeBase: {
    createdAt: "2026-08-14T00:00:00.000Z",
    createdBy: "user-1",
    id: "knowledge-1",
    name: "Knowledge",
    orgId: "org-1",
    updatedAt: "2026-08-14T00:00:00.000Z",
    workspaceId: "workspace-1",
  },
  knowledgeBaseId: "knowledge-1",
  orgId: "org-1",
  updatedAt: "2026-08-14T00:00:00.000Z",
});

describe("managed model mutation policies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completeMutationNetworkRevalidation();
    advanceMutationSessionBoundary();
  });

  it("invalidates only the updated model's exact workspace views", async () => {
    const client = createRomeoQueryClient();
    const listKey = apiQueryKeys.agents("workspace-1");
    const otherListKey = apiQueryKeys.agents("workspace-2");
    const versionsKey = appQueryKeys.agentVersions("agent-1");
    const otherVersionsKey = appQueryKeys.agentVersions("agent-2");
    client.setQueryData(listKey, { data: [agent("Before")] });
    client.setQueryData(otherListKey, { data: [] });
    client.setQueryData(versionsKey, []);
    client.setQueryData(otherVersionsKey, []);
    mutationMocks.updateAgent.mockResolvedValueOnce(agent("After"));
    const observer = new MutationObserver(
      client,
      updateAgentMutationOptions("workspace-1"),
    );

    await observer.mutate({ agentId: "agent-1", name: "After" });

    expect(client.getQueryState(listKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(versionsKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherListKey)?.isInvalidated).toBe(false);
    expect(client.getQueryState(otherVersionsKey)?.isInvalidated).toBe(false);
  });

  it("refreshes access views without crossing into another agent", async () => {
    const client = createRomeoQueryClient();
    const sharesKey = appQueryKeys.agentShares("agent-1");
    const otherSharesKey = appQueryKeys.agentShares("agent-2");
    const filteredAuditKey = appQueryKeys.auditLogs({
      filters: [{ field: "category", operator: "eq", value: "access" }],
      limit: 25,
      sort: [{ direction: "desc", field: "createdAt" }],
    });
    client.setQueryData(sharesKey, []);
    client.setQueryData(otherSharesKey, []);
    client.setQueryData(filteredAuditKey, []);
    mutationMocks.shareAgentAccess.mockResolvedValueOnce([]);
    const observer = new MutationObserver(
      client,
      shareAgentAccessMutationOptions(),
    );

    await observer.mutate({
      agentId: "agent-1",
      permissions: ["read"],
      principalId: "group-1",
      principalType: "group",
    });

    expect(client.getQueryState(sharesKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherSharesKey)?.isInvalidated).toBe(false);
    expect(client.getQueryState(filteredAuditKey)?.isInvalidated).toBe(true);
  });

  it("does not commit a managed-model result after logout", async () => {
    const client = createRomeoQueryClient();
    let resolveUpdate!: (value: Agent) => void;
    mutationMocks.updateAgent.mockReturnValueOnce(
      new Promise<Agent>((resolve) => {
        resolveUpdate = resolve;
      }),
    );
    const observer = new MutationObserver(
      client,
      updateAgentMutationOptions("workspace-1"),
    );
    const mutation = observer.mutate({ agentId: "agent-1", name: "After" });
    await vi.waitFor(() =>
      expect(mutationMocks.updateAgent).toHaveBeenCalled(),
    );

    await clearRouteDataForLogout(client);
    const listKey = apiQueryKeys.agents("workspace-1");
    client.setQueryData(listKey, { data: [] });
    resolveUpdate(agent("After"));
    await mutation;

    expect(client.getQueryState(listKey)?.isInvalidated).toBe(false);
  });

  it("refreshes only the created model workspace", async () => {
    const client = createRomeoQueryClient();
    const key = apiQueryKeys.agents("workspace-1");
    const otherKey = apiQueryKeys.agents("workspace-2");
    client.setQueryData(key, { data: [] });
    client.setQueryData(otherKey, { data: [] });
    mutationMocks.createAgent.mockResolvedValueOnce(agent("Created"));
    const observer = new MutationObserver(client, createAgentMutationOptions());

    await observer.mutate({
      baseModelId: "model-1",
      name: "Created",
      systemPrompt: "Be useful.",
      workspaceId: "workspace-1",
    });

    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherKey)?.isInvalidated).toBe(false);
  });

  it("rolls a knowledge binding back after authorization failure", async () => {
    const client = createRomeoQueryClient();
    const key = appQueryKeys.agentKnowledgeBindings("agent-1");
    client.setQueryData(key, [binding(false)]);
    let rejectUpdate!: (error: Error) => void;
    mutationMocks.updateAgentKnowledgeBinding.mockReturnValueOnce(
      new Promise<AgentKnowledgeBinding>((_resolve, reject) => {
        rejectUpdate = reject;
      }),
    );
    const observer = new MutationObserver(
      client,
      updateAgentKnowledgeBindingMutationOptions(),
    );
    const mutation = observer.mutate({
      agentId: "agent-1",
      enabled: true,
      knowledgeBaseId: "knowledge-1",
    });
    await vi.waitFor(() =>
      expect(
        client.getQueryData<AgentKnowledgeBinding[]>(key)?.[0]?.enabled,
      ).toBe(true),
    );

    rejectUpdate(new Error("forbidden"));
    await expect(mutation).rejects.toThrow("forbidden");
    expect(client.getQueryData(key)).toEqual([binding(false)]);
  });
});

import { MutationObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as appQueryKeys from "../../lib/app-query-keys";
import { completeMutationNetworkRevalidation } from "../../lib/connectivity";
import { advanceMutationSessionBoundary } from "../../lib/mutation-session-boundary";
import { createRomeoQueryClient } from "../../lib/query-client";
import type { AgentToolSummary } from "./types";
import { updateAgentToolBindingMutationOptions } from "./mutation-options";

const mutationMocks = vi.hoisted(() => ({
  updateAgentToolBinding: vi.fn(),
}));

vi.mock("./mutations", () => mutationMocks);

const tool = (enabled: boolean): AgentToolSummary => ({
  agentId: "agent-1",
  approvalPolicy: "explicit",
  approvalRequired: true,
  bound: true,
  description: "Search approved sources",
  enabled,
  hasAccess: true,
  id: "tool-1",
  name: "Search",
  requiredScopes: [],
  riskLevel: "medium",
  timeoutMs: 30_000,
});

describe("agent tool mutation policies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completeMutationNetworkRevalidation();
    advanceMutationSessionBoundary();
  });

  it("rolls an optimistic tool update back after a conflict", async () => {
    const client = createRomeoQueryClient();
    const key = appQueryKeys.agentTools("agent-1");
    client.setQueryData(key, [tool(false)]);
    let rejectUpdate!: (error: Error) => void;
    mutationMocks.updateAgentToolBinding.mockReturnValueOnce(
      new Promise<AgentToolSummary>((_resolve, reject) => {
        rejectUpdate = reject;
      }),
    );
    const observer = new MutationObserver(
      client,
      updateAgentToolBindingMutationOptions(),
    );
    const mutation = observer.mutate({
      agentId: "agent-1",
      enabled: true,
      toolId: "tool-1",
    });
    await vi.waitFor(() =>
      expect(client.getQueryData<AgentToolSummary[]>(key)?.[0]?.enabled).toBe(
        true,
      ),
    );

    rejectUpdate(new Error("version conflict"));
    await expect(mutation).rejects.toThrow("version conflict");
    expect(client.getQueryData(key)).toEqual([tool(false)]);
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  });
});

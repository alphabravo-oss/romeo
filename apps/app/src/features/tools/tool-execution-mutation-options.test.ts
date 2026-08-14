import { RomeoApiError } from "@romeo/api-client";
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
import { executeToolMutationOptions } from "./mutation-options";

const mutationMocks = vi.hoisted(() => ({
  executeTool: vi.fn(),
  updateAgentToolBinding: vi.fn(),
}));

vi.mock("./mutations", () => mutationMocks);

describe("tool execution mutation policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completeMutationNetworkRevalidation();
    advanceMutationSessionBoundary();
  });

  it("refreshes usage, audit, and only the executing agent tool calls", async () => {
    const client = createRomeoQueryClient();
    const affected = [
      appQueryKeys.usageEvents("24h"),
      appQueryKeys.usageEvents("30d"),
      appQueryKeys.usageSummary(),
      appQueryKeys.usageAlerts(),
      appQueryKeys.quotas(),
      appQueryKeys.toolCalls("agent-1"),
      appQueryKeys.auditLogs({ limit: 25 }),
    ];
    const otherAgent = appQueryKeys.toolCalls("agent-2");
    for (const key of [...affected, otherAgent]) client.setQueryData(key, []);
    mutationMocks.executeTool.mockResolvedValueOnce({ result: 4 });
    const observer = new MutationObserver(
      client,
      executeToolMutationOptions<{ result: number }>("tool_calculator"),
    );

    await observer.mutate({
      agentId: "agent-1",
      payload: { expression: "2 + 2" },
    });

    for (const key of affected) {
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    }
    expect(client.getQueryState(otherAgent)?.isInvalidated).toBe(false);
  });

  it("refreshes server-created approval state after an expected failure", async () => {
    const client = createRomeoQueryClient();
    const auditKey = appQueryKeys.auditLogs({ limit: 25 });
    const callsKey = appQueryKeys.toolCalls("agent-1");
    client.setQueryData(auditKey, []);
    client.setQueryData(callsKey, []);
    mutationMocks.executeTool.mockRejectedValueOnce(approvalRequiredError());
    const observer = new MutationObserver(
      client,
      executeToolMutationOptions("tool_datetime"),
    );

    await expect(
      observer.mutate({ agentId: "agent-1", payload: {} }),
    ).rejects.toMatchObject({ code: "tool_approval_required" });
    expect(client.getQueryState(auditKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(callsKey)?.isInvalidated).toBe(true);
  });

  it("does not refresh approval state when failure arrives after logout", async () => {
    const client = createRomeoQueryClient();
    let rejectExecution!: (error: Error) => void;
    mutationMocks.executeTool.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectExecution = reject;
      }),
    );
    const observer = new MutationObserver(
      client,
      executeToolMutationOptions("tool_datetime"),
    );
    const pending = observer.mutate({ agentId: "agent-1", payload: {} });
    await vi.waitFor(() =>
      expect(mutationMocks.executeTool).toHaveBeenCalled(),
    );

    await clearRouteDataForLogout(client);
    const key = appQueryKeys.toolCalls("agent-1");
    client.setQueryData(key, []);
    rejectExecution(approvalRequiredError());
    await expect(pending).rejects.toMatchObject({
      code: "tool_approval_required",
    });

    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  });

  it("executes no tool while offline", async () => {
    const client = createRomeoQueryClient();
    const observer = new MutationObserver(
      client,
      executeToolMutationOptions("tool_calculator"),
    );
    markMutationNetworkOffline();

    await expect(
      observer.mutate({ agentId: "agent-1", payload: {} }),
    ).rejects.toMatchObject({ code: "mutation_network_blocked" });
    expect(mutationMocks.executeTool).not.toHaveBeenCalled();
  });
});

function approvalRequiredError() {
  return new RomeoApiError("approval required", 409, {
    error: {
      code: "tool_approval_required",
      details: { approvalRequestId: "approval-1" },
      message: "approval required",
      request_id: "request-1",
    },
  });
}

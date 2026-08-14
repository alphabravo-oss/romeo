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
import type { ToolConnector, ToolOperation } from "./types";
import {
  checkToolConnectorAuthMutationOptions,
  dispatchToolOperationMutationOptions,
  importOpenApiToolMutationOptions,
  updateToolConnectorMutationOptions,
  updateToolOperationMutationOptions,
} from "./mutation-options";

const mutationMocks = vi.hoisted(() => ({
  checkToolConnectorAuth: vi.fn(),
  dispatchToolOperation: vi.fn(),
  importOpenApiTool: vi.fn(),
  testToolOperation: vi.fn(),
  updateToolConnector: vi.fn(),
  updateToolOperation: vi.fn(),
}));

vi.mock("./mutations", () => mutationMocks);

const connector = (enabled: boolean): ToolConnector => ({
  approvalPolicy: "external_side_effects",
  authConfig: {},
  createdAt: "2026-08-14T00:00:00.000Z",
  description: "Payments",
  enabled,
  id: "connector-1",
  name: "Payments",
  networkPolicy: {
    allowPrivateNetwork: false,
    allowedHosts: ["api.example.com"],
    mode: "allow_hosts",
  },
  orgId: "org-1",
  riskLevel: "high",
  schema: {},
  type: "openapi",
  updatedAt: "2026-08-14T00:00:00.000Z",
  visibility: "org",
});

const operation = (enabled: boolean): ToolOperation => ({
  approvalPolicy: "external_side_effects",
  connectorId: "connector-1",
  createdAt: "2026-08-14T00:00:00.000Z",
  description: "Create payment",
  enabled,
  id: "operation-1",
  inputSchema: {},
  method: "post",
  name: "Create payment",
  operationId: "createPayment",
  orgId: "org-1",
  outputSchema: {},
  path: "/payments",
  riskLevel: "high",
});

describe("tool connector mutation policies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completeMutationNetworkRevalidation();
    advanceMutationSessionBoundary();
  });

  it("rolls an optimistic connector toggle back after authorization failure", async () => {
    const client = createRomeoQueryClient();
    const key = appQueryKeys.toolConnectors();
    client.setQueryData(key, [connector(true)]);
    let rejectUpdate!: (error: Error) => void;
    mutationMocks.updateToolConnector.mockReturnValueOnce(
      new Promise<ToolConnector>((_resolve, reject) => {
        rejectUpdate = reject;
      }),
    );
    const observer = new MutationObserver(
      client,
      updateToolConnectorMutationOptions(),
    );
    const pending = observer.mutate({
      connectorId: "connector-1",
      enabled: false,
    });
    await vi.waitFor(() =>
      expect(client.getQueryData<ToolConnector[]>(key)?.[0]?.enabled).toBe(
        false,
      ),
    );

    rejectUpdate(new Error("forbidden"));
    await expect(pending).rejects.toThrow("forbidden");
    expect(client.getQueryData(key)).toEqual([connector(true)]);
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  });

  it("reconciles an import into exact connector, operation, and audit views", async () => {
    const client = createRomeoQueryClient();
    const connectorKey = appQueryKeys.toolConnectors();
    const operationKey = appQueryKeys.toolOperations("connector-1");
    const otherOperationKey = appQueryKeys.toolOperations("connector-2");
    const auditFirst = appQueryKeys.auditLogs({ limit: 25 });
    const auditNext = appQueryKeys.auditLogs({ cursor: "next", limit: 25 });
    client.setQueryData(connectorKey, []);
    client.setQueryData(operationKey, []);
    client.setQueryData(otherOperationKey, []);
    client.setQueryData(auditFirst, []);
    client.setQueryData(auditNext, []);
    mutationMocks.importOpenApiTool.mockResolvedValueOnce({
      connector: connector(true),
      operations: [operation(true)],
    });
    const observer = new MutationObserver(
      client,
      importOpenApiToolMutationOptions(),
    );

    await observer.mutate({ name: "Payments", spec: {} });

    expect(client.getQueryData(connectorKey)).toEqual([connector(true)]);
    expect(client.getQueryData(operationKey)).toEqual([operation(true)]);
    expect(client.getQueryState(connectorKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(operationKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherOperationKey)?.isInvalidated).toBe(false);
    expect(client.getQueryState(auditFirst)?.isInvalidated).toBe(true);
    expect(client.getQueryState(auditNext)?.isInvalidated).toBe(true);
  });

  it("rolls an optimistic operation toggle back after a conflict", async () => {
    const client = createRomeoQueryClient();
    const key = appQueryKeys.toolOperations("connector-1");
    client.setQueryData(key, [operation(true)]);
    mutationMocks.updateToolOperation.mockRejectedValueOnce(
      new Error("version_conflict"),
    );
    const observer = new MutationObserver(
      client,
      updateToolOperationMutationOptions(),
    );

    await expect(
      observer.mutate({
        connectorId: "connector-1",
        enabled: false,
        operationId: "createPayment",
      }),
    ).rejects.toThrow("version_conflict");
    expect(client.getQueryData(key)).toEqual([operation(true)]);
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  });

  it("refreshes every exact operational projection after dispatch", async () => {
    const client = createRomeoQueryClient();
    const keys = [
      appQueryKeys.usageEvents("24h"),
      appQueryKeys.usageEvents("30d"),
      appQueryKeys.usageSummary(),
      appQueryKeys.usageAlerts(),
      appQueryKeys.quotas(),
      appQueryKeys.toolCalls("agent-1"),
      appQueryKeys.toolCalls("agent-2"),
      appQueryKeys.auditLogs({ limit: 25 }),
    ];
    for (const key of keys) client.setQueryData(key, []);
    mutationMocks.dispatchToolOperation.mockResolvedValueOnce({ job: {} });
    const observer = new MutationObserver(
      client,
      dispatchToolOperationMutationOptions(),
    );

    await observer.mutate({
      connectorId: "connector-1",
      operationId: "createPayment",
    });

    for (const key of keys) {
      expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    }
  });

  it("does not refresh a dispatch result that resolves after logout", async () => {
    const client = createRomeoQueryClient();
    let resolveDispatch!: (value: { job: object }) => void;
    mutationMocks.dispatchToolOperation.mockReturnValueOnce(
      new Promise<{ job: object }>((resolve) => {
        resolveDispatch = resolve;
      }),
    );
    const observer = new MutationObserver(
      client,
      dispatchToolOperationMutationOptions(),
    );
    const pending = observer.mutate({
      connectorId: "connector-1",
      operationId: "createPayment",
    });
    await vi.waitFor(() =>
      expect(mutationMocks.dispatchToolOperation).toHaveBeenCalled(),
    );

    await clearRouteDataForLogout(client);
    const key = appQueryKeys.auditLogs({ limit: 25 });
    client.setQueryData(key, []);
    resolveDispatch({ job: {} });
    await pending;

    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  });

  it("fails an auth probe closed offline without invoking the API", async () => {
    const client = createRomeoQueryClient();
    const observer = new MutationObserver(
      client,
      checkToolConnectorAuthMutationOptions(),
    );
    markMutationNetworkOffline();

    await expect(observer.mutate("connector-1")).rejects.toMatchObject({
      code: "mutation_network_blocked",
    });
    expect(mutationMocks.checkToolConnectorAuth).not.toHaveBeenCalled();
  });
});

import { MutationObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as appQueryKeys from "../../lib/app-query-keys";
import { completeMutationNetworkRevalidation } from "../../lib/connectivity";
import { advanceMutationSessionBoundary } from "../../lib/mutation-session-boundary";
import { createRomeoQueryClient } from "../../lib/query-client";
import type { Workflow, WorkflowRun } from "./types";
import {
  createWorkflowMutationOptions,
  startWorkflowRunMutationOptions,
} from "./mutation-options";

const mutationMocks = vi.hoisted(() => ({
  approveWorkflowRun: vi.fn(),
  createWorkflow: vi.fn(),
  createWorkflowFromTemplate: vi.fn(),
  resumeWorkflowRun: vi.fn(),
  startWorkflowRun: vi.fn(),
}));

vi.mock("./mutations", () => mutationMocks);

const workflow = (name: string): Workflow => ({
  createdAt: "2026-08-14T00:00:00.000Z",
  createdBy: "user-1",
  enabled: true,
  id: "workflow-1",
  name,
  orgId: "org-1",
  steps: [],
  updatedAt: "2026-08-14T00:00:00.000Z",
  workspaceId: "workspace-1",
});

const run = (): WorkflowRun => ({
  createdAt: "2026-08-14T00:00:00.000Z",
  createdBy: "user-1",
  id: "run-1",
  input: {},
  orgId: "org-1",
  status: "waiting_run",
  steps: [],
  updatedAt: "2026-08-14T00:00:00.000Z",
  workflowId: "workflow-1",
  workspaceId: "workspace-1",
});

describe("workflow mutation policies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completeMutationNetworkRevalidation();
    advanceMutationSessionBoundary();
  });

  it("reconciles and exactly invalidates the created workflow workspace", async () => {
    const client = createRomeoQueryClient();
    const key = appQueryKeys.workflows("workspace-1");
    const otherKey = appQueryKeys.workflows("workspace-2");
    client.setQueryData(key, [workflow("Before")]);
    client.setQueryData(otherKey, []);
    mutationMocks.createWorkflow.mockResolvedValueOnce(workflow("After"));
    const observer = new MutationObserver(
      client,
      createWorkflowMutationOptions(),
    );

    await observer.mutate({
      name: "After",
      steps: [],
      workspaceId: "workspace-1",
    });

    expect(client.getQueryData<Workflow[]>(key)?.[0]?.name).toBe("After");
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherKey)?.isInvalidated).toBe(false);
  });

  it("does not reconcile or invalidate a failed workflow write", async () => {
    const client = createRomeoQueryClient();
    const key = appQueryKeys.workflows("workspace-1");
    client.setQueryData(key, [workflow("Before")]);
    mutationMocks.createWorkflow.mockRejectedValueOnce(new Error("conflict"));
    const observer = new MutationObserver(
      client,
      createWorkflowMutationOptions(),
    );

    await expect(
      observer.mutate({
        name: "After",
        steps: [],
        workspaceId: "workspace-1",
      }),
    ).rejects.toThrow("conflict");

    expect(client.getQueryData(key)).toEqual([workflow("Before")]);
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  });

  it("adds a started run only to its exact workflow", async () => {
    const client = createRomeoQueryClient();
    const key = appQueryKeys.workflowRuns("workflow-1");
    const otherKey = appQueryKeys.workflowRuns("workflow-2");
    client.setQueryData(key, []);
    client.setQueryData(otherKey, []);
    mutationMocks.startWorkflowRun.mockResolvedValueOnce(run());
    const observer = new MutationObserver(
      client,
      startWorkflowRunMutationOptions(),
    );

    await observer.mutate({ workflowId: "workflow-1" });

    expect(client.getQueryData<WorkflowRun[]>(key)?.[0]?.id).toBe("run-1");
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherKey)?.isInvalidated).toBe(false);
  });
});

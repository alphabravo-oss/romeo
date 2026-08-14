import { MutationObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as appQueryKeys from "../../lib/app-query-keys";
import { completeMutationNetworkRevalidation } from "../../lib/connectivity";
import { advanceMutationSessionBoundary } from "../../lib/mutation-session-boundary";
import { createRomeoQueryClient } from "../../lib/query-client";
import { clearRouteDataForLogout } from "../../lib/route-intent";
import type { EvalResultHumanRating, EvalRun, EvalSuite } from "./types";
import {
  createEvalSuiteMutationOptions,
  rateEvalResultMutationOptions,
  runEvalSuiteMutationOptions,
} from "./mutation-options";

const mutationMocks = vi.hoisted(() => ({
  createEvalSuite: vi.fn(),
  rateEvalResult: vi.fn(),
  runEvalSuite: vi.fn(),
}));

vi.mock("./mutations", () => mutationMocks);

const suite = (name: string): EvalSuite => ({
  agentId: "agent-1",
  createdAt: "2026-08-14T00:00:00.000Z",
  createdBy: "user-1",
  id: "suite-1",
  name,
  orgId: "org-1",
  updatedAt: "2026-08-14T00:00:00.000Z",
  workspaceId: "workspace-1",
});

const run = (): EvalRun => ({
  agentId: "agent-1",
  completedAt: "2026-08-14T00:01:00.000Z",
  createdAt: "2026-08-14T00:00:00.000Z",
  createdBy: "user-1",
  id: "run-1",
  modelId: "model-1",
  orgId: "org-1",
  score: 1,
  status: "passed",
  suiteId: "suite-1",
  workspaceId: "workspace-1",
});

const rating = (): EvalResultHumanRating => ({
  createdAt: "2026-08-14T00:00:00.000Z",
  id: "rating-1",
  orgId: "org-1",
  rating: "pass",
  resultId: "result-1",
  reviewerId: "user-1",
  runId: "run-1",
  updatedAt: "2026-08-14T00:00:00.000Z",
});

describe("evaluation mutation policies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completeMutationNetworkRevalidation();
    advanceMutationSessionBoundary();
  });

  it("reconciles a suite into only its exact agent inventory", async () => {
    const client = createRomeoQueryClient();
    const key = appQueryKeys.evalSuites("agent-1");
    const otherKey = appQueryKeys.evalSuites("agent-2");
    client.setQueryData(key, [suite("Before")]);
    client.setQueryData(otherKey, []);
    mutationMocks.createEvalSuite.mockResolvedValueOnce({
      cases: [],
      suite: suite("After"),
    });
    const observer = new MutationObserver(
      client,
      createEvalSuiteMutationOptions(),
    );

    await observer.mutate({ agentId: "agent-1", cases: [], name: "After" });

    expect(client.getQueryData<EvalSuite[]>(key)?.[0]?.name).toBe("After");
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherKey)?.isInvalidated).toBe(false);
  });

  it("leaves cached suites unchanged after a conflict", async () => {
    const client = createRomeoQueryClient();
    const key = appQueryKeys.evalSuites("agent-1");
    client.setQueryData(key, [suite("Before")]);
    mutationMocks.createEvalSuite.mockRejectedValueOnce(new Error("conflict"));
    const observer = new MutationObserver(
      client,
      createEvalSuiteMutationOptions(),
    );

    await expect(
      observer.mutate({ agentId: "agent-1", cases: [], name: "After" }),
    ).rejects.toThrow("conflict");
    expect(client.getQueryData(key)).toEqual([suite("Before")]);
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  });

  it("does not commit a completed evaluation after logout", async () => {
    const client = createRomeoQueryClient();
    let resolveRun!: (value: { run: EvalRun; results: [] }) => void;
    mutationMocks.runEvalSuite.mockReturnValueOnce(
      new Promise<{ run: EvalRun; results: [] }>((resolve) => {
        resolveRun = resolve;
      }),
    );
    const observer = new MutationObserver(
      client,
      runEvalSuiteMutationOptions("agent-1"),
    );
    const mutation = observer.mutate({
      suiteId: "suite-1",
      reasoningPolicy: { schemaVersion: 1, mode: "off" },
    });
    await vi.waitFor(() =>
      expect(mutationMocks.runEvalSuite).toHaveBeenCalled(),
    );

    await clearRouteDataForLogout(client);
    const key = appQueryKeys.evalRuns("agent-1");
    client.setQueryData(key, []);
    resolveRun({ results: [], run: run() });
    await mutation;

    expect(client.getQueryData(key)).toEqual([]);
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  });

  it("invalidates only the completed suite reasoning comparison", async () => {
    const client = createRomeoQueryClient();
    const comparisonKey = appQueryKeys.evalReasoningComparison("suite-1");
    const otherKey = appQueryKeys.evalReasoningComparison("suite-2");
    client.setQueryData(comparisonKey, { variants: [] });
    client.setQueryData(otherKey, { variants: [] });
    mutationMocks.runEvalSuite.mockResolvedValueOnce({
      results: [],
      run: run(),
    });
    const observer = new MutationObserver(
      client,
      runEvalSuiteMutationOptions("agent-1"),
    );

    await observer.mutate({
      suiteId: "suite-1",
      reasoningPolicy: { schemaVersion: 1, mode: "auto", effort: "low" },
    });

    expect(client.getQueryState(comparisonKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherKey)?.isInvalidated).toBe(false);
  });

  it("reconciles a rating into only its exact run", async () => {
    const client = createRomeoQueryClient();
    const key = appQueryKeys.evalRatings("run-1");
    const otherKey = appQueryKeys.evalRatings("run-2");
    client.setQueryData(key, []);
    client.setQueryData(otherKey, []);
    mutationMocks.rateEvalResult.mockResolvedValueOnce(rating());
    const observer = new MutationObserver(
      client,
      rateEvalResultMutationOptions(),
    );

    await observer.mutate({
      rating: "pass",
      resultId: "result-1",
      runId: "run-1",
    });

    expect(client.getQueryData<EvalResultHumanRating[]>(key)?.[0]?.id).toBe(
      "rating-1",
    );
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherKey)?.isInvalidated).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import type { EvalRun } from "../domain/entities";
import { buildEvalReasoningComparison } from "./eval-reasoning-comparison";

const policy = { schemaVersion: 1, mode: "off" } as const;

describe("eval reasoning comparison", () => {
  it("does not present partial usage or costs as comparable totals", () => {
    const complete = run("run-1", {
      coverage: "complete",
      inputTokens: 4,
      outputTokens: 7,
      reasoningTokens: 2,
    });
    const partial = run("run-2", {
      coverage: "partial",
      outputTokens: 5,
    });
    partial.metrics = {
      latencyMs: 20,
      usage: partial.metrics!.usage,
      costBasis: "unavailable",
    };
    const comparison = buildEvalReasoningComparison("suite-1", [
      complete,
      partial,
    ]);

    expect(comparison.variants[0]).toMatchObject({
      runCount: 2,
      averageScore: 0.75,
      averageLatencyMs: 15,
      reportedInputTokens: null,
      reportedOutputTokens: null,
      reportedReasoningTokens: null,
      estimatedCostUsd: null,
    });
  });
});

function run(
  id: string,
  usage: NonNullable<EvalRun["metrics"]>["usage"],
): EvalRun {
  return {
    id,
    orgId: "org-1",
    workspaceId: "workspace-1",
    agentId: "agent-1",
    suiteId: "suite-1",
    modelId: "model-1",
    status: "passed",
    score: id === "run-1" ? 1 : 0.5,
    createdBy: "user-1",
    createdAt: "2026-08-14T00:00:00.000Z",
    completedAt:
      id === "run-1" ? "2026-08-14T00:00:00.000Z" : "2026-08-14T00:01:00.000Z",
    reasoningPolicy: { requested: policy, effective: policy },
    metrics: {
      latencyMs: id === "run-1" ? 10 : 20,
      usage,
      costBasis: "reported_tokens",
      estimatedCostUsd: 0.1,
    },
  };
}

import { describe, expect, it } from "vitest";

import {
  buildRunContextManifest,
  projectRunContextInspection,
} from "./run-context-manifest";

describe("run context manifest", () => {
  it("projects authorized inspection without hidden reasoning or unauthorized sources", () => {
    const manifest = buildRunContextManifest({
      runId: "run_1",
      messageIds: ["m1", "m2"],
      checkpointIds: ["cp1"],
      knowledgeSourceIds: ["src_allowed", "src_hidden"],
      toolIds: ["tool_1"],
      policyVersions: ["content_policy:3"],
    });
    const inspection = projectRunContextInspection(
      manifest,
      new Set(["src_allowed"]),
    );
    expect(inspection).toEqual({
      schema: "romeo.run-context.inspection.v1",
      runId: "run_1",
      messageCount: 2,
      checkpointCount: 1,
      knowledgeSourceCount: 1,
      toolCount: 1,
      policyVersions: ["content_policy:3"],
      hiddenReasoningIncluded: false,
    });
    expect(JSON.stringify(inspection)).not.toContain("src_hidden");
    expect(JSON.stringify(inspection)).not.toContain("reasoning");
  });
});

import { describe, expect, it } from "vitest";

import { workspaceTurnExecutionMode } from "./workspace-turn-execution-mode";

describe("workspaceTurnExecutionMode", () => {
  it("keeps agent-default reasoning absent", () => {
    expect(
      workspaceTurnExecutionMode({
        reasoningMode: "default",
        researchMode: "standard",
        routingMode: "selected",
      }),
    ).toEqual({});
  });

  it("preserves an explicit high reasoning request with other turn modes", () => {
    expect(
      workspaceTurnExecutionMode({
        reasoningMode: "high",
        researchMode: "deep",
        routingMode: "economy",
      }),
    ).toEqual({
      reasoningPolicy: { effort: "high", mode: "auto", schemaVersion: 1 },
      researchMode: "deep",
      routingMode: "economy",
    });
  });
});

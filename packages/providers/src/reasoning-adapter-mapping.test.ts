import { describe, expect, it } from "vitest";

import { mapReasoningToNativeAdapter } from "./reasoning-adapter-mapping";

describe("reasoning adapter mapping", () => {
  it("maps first-class OpenAI dialects and requires opt-in for generic ones", () => {
    expect(
      mapReasoningToNativeAdapter({
        kind: "openai-compatible",
        effort: "low",
        summary: "auto",
      }),
    ).toEqual({
      outcome: "mapped",
      native: { reasoning_effort: "low" },
    });
    expect(
      mapReasoningToNativeAdapter({
        kind: "openai-responses-compatible",
        effort: "high",
        summary: "detailed",
      }),
    ).toEqual({
      outcome: "mapped",
      native: { reasoning: { effort: "high", summary: "detailed" } },
    });
    expect(
      mapReasoningToNativeAdapter({
        kind: "anthropic",
        effort: "medium",
        maxReasoningTokens: 2_000,
      }),
    ).toEqual({
      outcome: "omitted",
      reason: "capability_opt_in_required",
    });
    expect(
      mapReasoningToNativeAdapter({
        kind: "ollama",
        effort: "medium",
        maxReasoningTokens: 1_024,
        capabilities: { reasoning: true },
      }),
    ).toEqual({
      outcome: "mapped",
      native: { reasoning_effort: "medium", thinking_budget: 1_024 },
    });
  });
});

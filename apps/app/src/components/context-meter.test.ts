import { describe, expect, it } from "vitest";

// Reached by path because the ratchet bars apps/app from importing @romeo/core
// and the estimator is not on that package's barrel anyway. Test files are
// exempt from the ratchet, and this module imports nothing itself.
import { estimateTokens as serverEstimateTokens } from "../../../../packages/core/src/services/token-estimate";
import type { RunContextPreview } from "../features/chat";
import { contextMeterValue, estimateTokens } from "./context-meter";

function preview(overrides: {
  contextWindow?: number;
  estimatedInputTokens?: number;
  retainedDocuments?: string[];
}): RunContextPreview {
  return {
    attachments: {
      currentFiles: [],
      pendingImages: 0,
      retainedDocuments: overrides.retainedDocuments ?? [],
      retainedImages: 0,
    },
    budget: {
      estimatedInputTokens: overrides.estimatedInputTokens ?? 0,
      remainingInputTokens: 0,
      usableInputTokens: 0,
    },
    history: { availableMessages: 0, includedMessages: 0, truncated: false },
    knowledge: [],
    memories: [],
    messages: [],
    model: {
      contextWindow: overrides.contextWindow ?? 128_000,
      id: "model_1",
      name: "Test model",
    },
  };
}

describe("context meter", () => {
  it("agrees with the server token estimator on every shape that reaches it", () => {
    // Runs both functions rather than grepping the other package's source: a
    // drift here means the composer promises a budget the run will not honour,
    // and reformatting either file must not be able to fail or pass this.
    const samples = [
      "",
      " ",
      "\n\t ",
      "a",
      "abc",
      "1234",
      "12345",
      "12345678",
      "  padded draft  ",
      "café — 🙂",
      "x".repeat(4_001),
    ];
    // Each count is paired with the string that produced it, so a failure
    // diff names the input that drifted rather than an array index.
    expect(samples.map((sample) => [sample, estimateTokens(sample)])).toEqual(
      samples.map((sample) => [sample, serverEstimateTokens(sample)]),
    );
  });

  it("counts a draft the way the composer needs it counted", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("   ")).toBe(0);
    expect(estimateTokens("a")).toBe(1);
    expect(estimateTokens("12345678")).toBe(2);
  });

  it("estimates from the draft alone before anything is inspected", () => {
    expect(
      contextMeterValue({
        contextWindow: 8_000,
        draft: "12345678",
        preview: undefined,
      }),
    ).toEqual({
      contextWindow: 8_000,
      exact: false,
      percent: 0,
      retainedFiles: 0,
      usedTokens: 2,
    });
  });

  it("reports the inspected number exactly while the composer is empty", () => {
    expect(
      contextMeterValue({
        contextWindow: 8_000,
        draft: "",
        preview: preview({ estimatedInputTokens: 12_400 }),
      }),
    ).toEqual({
      contextWindow: 128_000,
      exact: true,
      percent: 10,
      retainedFiles: 0,
      usedTokens: 12_400,
    });
  });

  it("grows with the draft and stops being exact", () => {
    const value = contextMeterValue({
      contextWindow: 128_000,
      draft: "12345678",
      preview: preview({
        estimatedInputTokens: 100,
        retainedDocuments: ["file_a", "file_b"],
      }),
    });
    expect(value.usedTokens).toBe(102);
    expect(value.exact).toBe(false);
    expect(value.retainedFiles).toBe(2);
  });

  it("has no percentage when the model's window is unknown", () => {
    const value = contextMeterValue({
      contextWindow: undefined,
      draft: "hello",
      preview: undefined,
    });
    expect(value.contextWindow).toBeUndefined();
    expect(value.percent).toBeUndefined();
  });

  it("clamps an overflowing conversation to a full bar", () => {
    expect(
      contextMeterValue({
        contextWindow: undefined,
        draft: "",
        preview: preview({ contextWindow: 1_000, estimatedInputTokens: 4_000 }),
      }).percent,
    ).toBe(100);
  });
});

import { describe, expect, it } from "vitest";

// Reached by path because the ratchet bars apps/app from importing @romeo/core
// and the estimator is not on that package's barrel anyway. Test files are
// exempt from the ratchet, and this module imports nothing itself.
import { estimateTokens as serverEstimateTokens } from "../../../../packages/core/src/services/token-estimate";
import type { RunContextPreview } from "../features/chat";
import {
  contextMeterValue,
  estimateHistoryTokens,
  estimateTokens,
} from "./context-meter";

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

  it("estimates history from the visible transcript without an inspect click", () => {
    // "12345678" = 2 tokens + 4 framing each
    expect(
      estimateHistoryTokens([
        { role: "user", content: "12345678" },
        { role: "assistant", content: "12345678" },
        { role: "assistant", content: "", error: { code: "x" } },
      ]),
    ).toBe(12);
  });

  it("grows as the transcript and draft grow", () => {
    const value = contextMeterValue({
      contextWindow: 8_000,
      draft: "12345678",
      messages: [{ role: "user", content: "12345678" }],
      preview: undefined,
    });
    // history 2+4, draft 2
    expect(value.usedTokens).toBe(8);
    expect(value.exact).toBe(false);
    expect(value.percent).toBe(0);
  });

  it("uses the inspect preview for retained files and model window only", () => {
    const value = contextMeterValue({
      contextWindow: 8_000,
      draft: "",
      messages: [{ role: "user", content: "12345678" }],
      preview: preview({
        contextWindow: 128_000,
        estimatedInputTokens: 99_999,
        retainedDocuments: ["file_a", "file_b"],
      }),
    });
    // Live history wins over the stale inspect budget total.
    expect(value.usedTokens).toBe(6);
    expect(value.contextWindow).toBe(128_000);
    expect(value.retainedFiles).toBe(2);
    expect(value.exact).toBe(false);
  });

  it("includes the system prompt when provided", () => {
    const value = contextMeterValue({
      contextWindow: 1_000,
      draft: "",
      messages: [],
      preview: undefined,
      systemPrompt: "12345678",
    });
    expect(value.usedTokens).toBe(6);
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
        contextWindow: 10,
        draft: "x".repeat(400),
        messages: [],
        preview: undefined,
      }).percent,
    ).toBe(100);
  });
});

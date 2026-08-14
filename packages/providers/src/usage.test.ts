import { describe, expect, it } from "vitest";

import {
  normalizeProviderTokenUsage,
  usageFromOllamaPayload,
  usageFromOpenAiPayload,
} from "./usage";

describe("provider usage normalization", () => {
  it("normalizes OpenAI-compatible chat completion usage payloads", () => {
    expect(
      usageFromOpenAiPayload({
        usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
      }),
    ).toEqual({
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20,
      source: "openai-compatible",
    });
  });

  it("normalizes cached-input and reasoning token details without double-counting totals", () => {
    expect(
      usageFromOpenAiPayload({
        usage: {
          prompt_tokens: 120,
          completion_tokens: 30,
          total_tokens: 150,
          prompt_tokens_details: { cached_tokens: 80 },
          completion_tokens_details: { reasoning_tokens: 20 },
        },
      }),
    ).toEqual({
      inputTokens: 120,
      cachedInputTokens: 80,
      outputTokens: 30,
      reasoningTokens: 20,
      totalTokens: 150,
      source: "openai-compatible",
    });
  });

  it("keeps an inferred component sum distinct from a reported total", () => {
    expect(
      usageFromOpenAiPayload({ input_tokens: 4, output_tokens: 6 }),
    ).toEqual({
      inputTokens: 4,
      outputTokens: 6,
      source: "openai-compatible",
    });
  });

  it("normalizes OpenAI Responses stream completion envelopes", () => {
    expect(
      usageFromOpenAiPayload({
        type: "response.completed",
        response: {
          usage: { input_tokens: 5, output_tokens: 7, total_tokens: 12 },
        },
      }),
    ).toEqual({
      inputTokens: 5,
      outputTokens: 7,
      totalTokens: 12,
      source: "openai-compatible",
    });
    expect(
      usageFromOpenAiPayload({
        data: { response: { usage: { input_tokens: 3, output_tokens: 4 } } },
      }),
    ).toEqual({
      inputTokens: 3,
      outputTokens: 4,
      source: "openai-compatible",
    });
  });

  it("normalizes Ollama final response token counts", () => {
    expect(
      usageFromOllamaPayload({ prompt_eval_count: 17, eval_count: 9 }),
    ).toEqual({
      inputTokens: 17,
      outputTokens: 9,
      source: "ollama",
    });
  });

  it("accepts existing Romeo token fields from custom adapters", () => {
    expect(
      normalizeProviderTokenUsage(
        { inputTokens: 2, outputTokens: 3 },
        { source: "custom" },
      ),
    ).toEqual({
      inputTokens: 2,
      outputTokens: 3,
      source: "custom",
    });
  });

  it("rejects negative, fractional, and missing usage counts", () => {
    expect(
      normalizeProviderTokenUsage({
        usage: { prompt_tokens: -1, completion_tokens: 1.5 },
      }),
    ).toBeUndefined();
    expect(
      normalizeProviderTokenUsage({ usage: { model: "gpt-compatible" } }),
    ).toBeUndefined();
    expect(normalizeProviderTokenUsage(undefined)).toBeUndefined();
  });

  it("drops an impossible reasoning component that exceeds reported output", () => {
    expect(
      usageFromOpenAiPayload({
        usage: {
          completion_tokens: 2,
          completion_tokens_details: { reasoning_tokens: 3 },
        },
      }),
    ).toEqual({
      outputTokens: 2,
      source: "openai-compatible",
    });
  });
});

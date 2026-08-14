import { describe, expect, it } from "vitest";

import {
  openAiCompatibleCapabilities,
  openAiResponsesCompatibleCapabilities,
} from "./capabilities";
import { profileDiscoveredModel } from "./model-discovery";

describe("discovered model profiles", () => {
  it("prefers provider metadata over name guesses", () => {
    const profile = profileDiscoveredModel({
      base: openAiCompatibleCapabilities,
      fallbackContextWindow: 128000,
      name: "acme-chat",
      metadata: {
        context_length: 65536,
        supported_parameters: ["max_tokens", "tools", "response_format"],
        architecture: { input_modalities: ["text", "image"] },
        pricing: { prompt: "0.000001", completion: "0.000002" },
        top_provider: { max_completion_tokens: 4096 },
      },
    });
    expect(profile.contextWindow).toBe(65536);
    expect(profile.defaultParameters).toEqual({ maxOutputTokens: 4096 });
    expect(profile.capabilities).toMatchObject({
      reasoning: false,
      temperature: false,
      toolCalling: true,
      vision: true,
    });
    expect(profile.pricing).toEqual({
      inputTokenUsd: 0.000001,
      outputTokenUsd: 0.000002,
    });
  });

  it("marks o-series and DeepSeek reasoners as thinking models that reject temperature", () => {
    const o3 = profileDiscoveredModel({
      base: openAiCompatibleCapabilities,
      fallbackContextWindow: 128000,
      name: "o3-mini",
    });
    expect(o3.capabilities.reasoning).toBe(true);
    expect(o3.capabilities.temperature).toBe(false);
    expect(o3.contextWindow).toBe(200_000);

    const deepseek = profileDiscoveredModel({
      base: openAiCompatibleCapabilities,
      fallbackContextWindow: 128000,
      name: "deepseek-v4-flash-0731",
    });
    expect(deepseek.capabilities.reasoning).toBe(true);
    expect(deepseek.capabilities.temperature).toBe(true);
    expect(deepseek.defaultParameters?.maxOutputTokens).toBe(16384);
  });

  it("does not treat chat models as image generators", () => {
    const profile = profileDiscoveredModel({
      base: openAiCompatibleCapabilities,
      fallbackContextWindow: 128000,
      name: "deepseek-v4-flash-0731",
    });
    expect(profile.capabilities.imageGeneration).toBe(false);
  });

  it("preserves provider reasoning support when a model name has no reasoning hint", () => {
    const profile = profileDiscoveredModel({
      base: openAiResponsesCompatibleCapabilities,
      fallbackContextWindow: 128000,
      name: "gpt-compatible",
    });

    expect(profile.capabilities.reasoning).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { defaultProviderCapabilities } from "@romeo/providers";

import {
  collectModelConfigAttention,
  isAnalyticsNoiseMetric,
  modelConfigIssues,
} from "./model-config-attention";

function model(
  overrides: Partial<Parameters<typeof collectModelConfigAttention>[0][number]> = {},
) {
  return {
    id: "model_chat",
    providerId: "provider_a",
    name: "chat",
    displayName: "Chat",
    enabled: true,
    capabilities: defaultProviderCapabilities("openai-compatible"),
    contextWindow: 8000,
    ...overrides,
  };
}

describe("model config attention", () => {
  it("ignores disabled models and flags missing pricing, context, and output", () => {
    expect(modelConfigIssues(model({ enabled: false }))).toEqual([]);
    expect(
      modelConfigIssues(
        model({
          contextWindow: 0,
          pricing: { inputTokenUsd: 0, outputTokenUsd: 0 },
        }),
      ),
    ).toEqual([
      "invalid_context_window",
      "missing_pricing",
      "missing_max_output",
    ]);
  });

  it("treats unavailable enabled models as needing attention", () => {
    expect(modelConfigIssues(model({ available: false }))).toEqual([
      "unavailable",
      "missing_pricing",
      "missing_max_output",
    ]);
  });

  it("collects only models with issues", () => {
    const ready = model({
      id: "model_ready",
      displayName: "Ready",
      pricing: { inputTokenUsd: 0.000001, outputTokenUsd: 0.000002 },
      defaultParameters: { maxOutputTokens: 1024 },
    });
    const items = collectModelConfigAttention([
      ready,
      model({ id: "model_gap", displayName: "Gap" }),
    ]);
    expect(items.map((item) => item.modelId)).toEqual(["model_gap"]);
  });
});

describe("analytics noise metrics", () => {
  it("excludes SSE and queue-wait telemetry from activity rollups", () => {
    expect(isAnalyticsNoiseMetric("sse.reconnect")).toBe(true);
    expect(isAnalyticsNoiseMetric("queue.wait")).toBe(true);
    expect(isAnalyticsNoiseMetric("run.started")).toBe(false);
  });
});

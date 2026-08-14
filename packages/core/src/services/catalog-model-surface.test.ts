import { describe, expect, it } from "vitest";

import {
  catalogModelSurface,
  explainModelUnavailability,
} from "./catalog-model-surface";

describe("catalogModelSurface", () => {
  it("labels native, emulated, and unsupported capabilities plus probe freshness", () => {
    const surface = catalogModelSurface({
      deploymentMode: "hosted-api",
      model: {
        capabilities: {
          modalities: ["text", "vision"],
          reasoning: false,
          toolCalling: true,
          vision: true,
        },
        capabilitiesSource: "override",
        contextWindow: 128_000,
        defaultParameters: { maxOutputTokens: 4_096 },
        pricing: { inputTokenUsd: 0.001, outputTokenUsd: 0.002 },
      },
      now: Date.parse("2026-08-14T12:00:00.000Z"),
      probedAt: "2026-08-14T11:00:00.000Z",
      region: "us-east-1",
    });
    expect(surface).toMatchObject({
      contextWindow: 128_000,
      deploymentBoundary: "hosted-api",
      maxOutputTokens: 4_096,
      probeFreshness: "fresh",
      reasoning: "unsupported",
      region: "us-east-1",
      tools: "emulated",
      vision: "emulated",
    });
  });

  it("names the exact constraint that makes a model unavailable", () => {
    expect(
      explainModelUnavailability({
        model: {
          entitled: true,
          imageOutput: false,
          localRuntime: false,
          reasoning: true,
          regionAllowed: true,
          tools: false,
        },
        required: {
          attachments: false,
          imageOutput: false,
          localOnly: false,
          reasoning: false,
          tools: true,
        },
      }),
    ).toEqual({ constraint: "tools_unsupported", outcome: "unavailable" });
  });
});

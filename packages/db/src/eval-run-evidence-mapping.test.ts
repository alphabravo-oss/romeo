import { describe, expect, it } from "vitest";

import { evalRunEvidenceFromUnknown } from "./eval-run-evidence-mapping";

describe("eval run reasoning evidence mapping", () => {
  it("keeps old nullable rows backward compatible", () => {
    expect(
      evalRunEvidenceFromUnknown({ reasoningPolicy: null, metrics: null }),
    ).toEqual({});
  });

  it("accepts strict bounded policy and complete reported metrics", () => {
    expect(
      evalRunEvidenceFromUnknown({
        reasoningPolicy: {
          requested: { schemaVersion: 1, mode: "auto", effort: "low" },
          effective: { schemaVersion: 1, mode: "auto", effort: "low" },
        },
        metrics: {
          latencyMs: 12,
          usage: {
            coverage: "complete",
            inputTokens: 4,
            outputTokens: 7,
            reasoningTokens: 2,
            source: "openai-compatible",
          },
          costBasis: "reported_tokens",
          estimatedCostUsd: 0.001,
        },
      }),
    ).toMatchObject({
      reasoningPolicy: {
        requested: { mode: "auto", effort: "low" },
        effective: { mode: "auto", effort: "low" },
      },
      metrics: {
        usage: { reasoningTokens: 2 },
        costBasis: "reported_tokens",
      },
    });
  });

  it("fails closed for extra keys, impossible subsets, and fake cost provenance", () => {
    expect(
      evalRunEvidenceFromUnknown({
        reasoningPolicy: {
          requested: { schemaVersion: 1, mode: "off" },
          effective: { schemaVersion: 1, mode: "off" },
          rawReasoning: "SECRET",
        },
        metrics: {
          latencyMs: 12,
          usage: {
            coverage: "partial",
            outputTokens: 2,
            reasoningTokens: 3,
          },
          costBasis: "unavailable",
          estimatedCostUsd: 9,
        },
      }),
    ).toEqual({});
  });
});

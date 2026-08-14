import { describe, expect, it } from "vitest";

import { defaultProviderCapabilities } from "./capabilities";
import {
  providerReasoningPolicyFromUnknown,
  resolveProviderReasoningPolicy,
} from "./reasoning-policy";
import type { BaseModel, ProviderInstance, ProviderKind } from "./types";

describe("provider reasoning policy", () => {
  it("applies run request over agent default, then the organization maximum", () => {
    const target = fixture("openai-responses-compatible");
    const resolution = resolveProviderReasoningPolicy({
      ...target,
      kind: "openai-responses-compatible",
      layers: {
        agentDefault: { schemaVersion: 1, mode: "auto", effort: "medium" },
        runRequest: {
          schemaVersion: 1,
          mode: "auto",
          effort: "high",
        },
        organizationMaximum: {
          schemaVersion: 1,
          mode: "auto",
          effort: "low",
        },
      },
    });

    expect(resolution).toMatchObject({
      source: "run_request",
      requested: {
        mode: "auto",
        effort: "high",
      },
      effective: { mode: "auto", effort: "low" },
      nativeParameters: { effort: "low" },
      adjustments: [{ parameter: "effort", reason: "capped_by_governance" }],
      // A governance cap is enforceable: the run proceeds at the clamped
      // effort rather than failing with a 400.
      rejected: false,
    });
  });

  it("drops an inherited token ceiling no dialect can express, without disabling reasoning", () => {
    // Every reasoning_policy default configuration carries maxReasoningTokens,
    // so this ceiling reaches the dialect check on every single run. It must
    // not turn reasoning off -- the caller asked for no budget at all.
    const target = fixture("openai-responses-compatible");
    const resolution = resolveProviderReasoningPolicy({
      ...target,
      kind: "openai-responses-compatible",
      layers: {
        runRequest: { schemaVersion: 1, mode: "auto", effort: "medium" },
        organizationMaximum: {
          schemaVersion: 1,
          mode: "auto",
          effort: "high",
          maxReasoningTokens: 8_000,
        },
      },
    });

    expect(resolution?.effective).toEqual({
      schemaVersion: 1,
      mode: "auto",
      effort: "medium",
    });
    expect(resolution?.rejected).toBe(false);
  });

  it("fails closed on a token budget the caller explicitly asked for", () => {
    // Unchanged, deliberate behaviour: a budget the caller requested is a
    // safety constraint, so an unenforceable one must not run unbounded.
    const target = fixture("openai-responses-compatible");
    const resolution = resolveProviderReasoningPolicy({
      ...target,
      kind: "openai-responses-compatible",
      layers: {
        runRequest: {
          schemaVersion: 1,
          mode: "auto",
          effort: "medium",
          maxReasoningTokens: 4_000,
        },
      },
    });

    expect(resolution?.effective.mode).toBe("off");
    expect(resolution?.rejected).toBe(true);
  });

  it("caps effort without rejecting when only governance adjusted it", () => {
    const target = fixture("openai-responses-compatible");
    const resolution = resolveProviderReasoningPolicy({
      ...target,
      kind: "openai-responses-compatible",
      layers: {
        runRequest: { schemaVersion: 1, mode: "auto", effort: "high" },
        organizationMaximum: {
          schemaVersion: 1,
          mode: "auto",
          effort: "low",
        },
      },
    });

    expect(resolution?.effective).toMatchObject({ effort: "low" });
    expect(resolution?.nativeParameters).toEqual({ effort: "low" });
    expect(resolution?.rejected).toBe(false);
  });

  it.each([
    ["anthropic", "off", undefined],
    ["ollama", "off", undefined],
    ["openai-compatible", "auto", { effort: "high" }],
    ["openai-responses-compatible", "auto", { effort: "high" }],
  ] as const)(
    "%s maps only its supported native controls",
    (kind, expectedMode, nativeParameters) => {
      const resolution = resolveProviderReasoningPolicy({
        ...fixture(kind),
        kind,
        layers: {
          agentDefault: {
            schemaVersion: 1,
            mode: "auto",
            effort: "high",
          },
        },
      });

      expect(resolution?.effective.mode).toBe(expectedMode);
      expect(resolution?.nativeParameters).toEqual(nativeParameters);
      expect(resolution?.rejected).toBe(expectedMode === "off");
    },
  );

  it.each([
    "anthropic",
    "ollama",
    "openai-compatible",
    "openai-responses-compatible",
  ] as const)(
    "%s fails reasoning closed when a requested token maximum cannot be enforced",
    (kind) => {
      const resolution = resolveProviderReasoningPolicy({
        ...fixture(kind),
        kind,
        layers: {
          runRequest: {
            schemaVersion: 1,
            mode: "auto",
            effort: "medium",
            maxReasoningTokens: 8_000,
          },
        },
      });

      expect(resolution).toMatchObject({
        effective: { schemaVersion: 1, mode: "off" },
        rejected: true,
      });
      expect(resolution?.adjustments).toContainEqual({
        parameter:
          kind === "openai-compatible" || kind === "openai-responses-compatible"
            ? "maxReasoningTokens"
            : "mode",
        reason: "unsupported_by_dialect",
      });
      expect(resolution?.nativeParameters).toBeUndefined();
    },
  );

  it("allows summary mode only on a dialect with safe-summary support", () => {
    const resolution = resolveProviderReasoningPolicy({
      ...fixture("openai-responses-compatible"),
      kind: "openai-responses-compatible",
      layers: {
        runRequest: {
          schemaVersion: 1,
          mode: "summary",
          retainSummary: true,
        },
      },
    });

    expect(resolution).toMatchObject({
      effective: { mode: "summary", retainSummary: true },
      adjustments: [],
      rejected: false,
    });

    expect(
      resolveProviderReasoningPolicy({
        ...fixture("openai-compatible"),
        kind: "openai-compatible",
        layers: {
          runRequest: {
            schemaVersion: 1,
            mode: "summary",
            retainSummary: true,
          },
        },
      }),
    ).toMatchObject({
      effective: { mode: "off" },
      adjustments: [{ parameter: "mode", reason: "unsupported_by_dialect" }],
      rejected: true,
    });
  });

  it("lets an explicit run off request override an enabled agent default", () => {
    const resolution = resolveProviderReasoningPolicy({
      ...fixture("openai-responses-compatible"),
      kind: "openai-responses-compatible",
      layers: {
        agentDefault: { schemaVersion: 1, mode: "auto", effort: "high" },
        runRequest: { schemaVersion: 1, mode: "off" },
      },
    });

    expect(resolution).toMatchObject({
      source: "run_request",
      requested: { mode: "off" },
      effective: { mode: "off" },
      adjustments: [],
      rejected: false,
    });
  });

  it("strictly parses durable policies and rejects secret-bearing extensions", () => {
    expect(
      providerReasoningPolicyFromUnknown({
        schemaVersion: 1,
        mode: "auto",
        effort: "high",
      }),
    ).toEqual({ schemaVersion: 1, mode: "auto", effort: "high" });
    expect(
      providerReasoningPolicyFromUnknown({
        schemaVersion: 1,
        mode: "summary",
        retainSummary: true,
        rawTrace: "private-secret",
      }),
    ).toBeUndefined();
  });
});

function fixture(kind: ProviderKind): {
  model: BaseModel;
  provider: ProviderInstance;
} {
  const capabilities = {
    ...defaultProviderCapabilities(kind),
    reasoning: true,
  };
  const provider: ProviderInstance = {
    id: `provider_${kind}`,
    orgId: "org_default",
    type: kind,
    name: kind,
    baseUrl: "https://provider.invalid",
    enabled: true,
    capabilities,
  };
  return {
    provider,
    model: {
      id: `model_${kind}`,
      providerId: provider.id,
      name: "model",
      displayName: "Model",
      enabled: true,
      capabilities,
      contextWindow: 128_000,
    },
  };
}

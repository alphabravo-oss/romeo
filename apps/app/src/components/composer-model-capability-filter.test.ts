import { describe, expect, it } from "vitest";

import type { BaseModel } from "../features/types";
import {
  modelMatchesCapabilityFilter,
  modelSupportsTurnRequirements,
} from "./composer-model-capability-filter";

const model = {
  available: true,
  capabilities: {
    audioInput: false,
    deployment: {
      credentialRequired: true,
      mode: "hosted-api",
      networkAccess: "external-http",
    },
    modalities: ["text"],
    reasoning: true,
    streaming: true,
    structuredJson: true,
    toolCalling: false,
    vision: false,
  },
  contextWindow: 128_000,
  displayName: "Reasoning model",
  enabled: true,
  id: "model_reasoning",
  name: "reasoning-model",
  providerId: "provider_1",
} satisfies BaseModel;

describe("modelMatchesCapabilityFilter", () => {
  it("filters from the effective model capability report", () => {
    expect(modelMatchesCapabilityFilter(model, "reasoning")).toBe(true);
    expect(modelMatchesCapabilityFilter(model, "tools")).toBe(false);
    expect(modelMatchesCapabilityFilter(model, "vision")).toBe(false);
    expect(modelMatchesCapabilityFilter(model, "economy")).toBe(false);
  });

  it("does not claim missing custom-model base metadata supports a feature", () => {
    expect(modelMatchesCapabilityFilter(undefined, "reasoning")).toBe(false);
    expect(modelMatchesCapabilityFilter(undefined, "all")).toBe(true);
  });

  it("requires the capabilities used by the pending turn", () => {
    expect(
      modelSupportsTurnRequirements(model, { reasoning: true, vision: false }),
    ).toBe(true);
    expect(
      modelSupportsTurnRequirements(model, { reasoning: true, vision: true }),
    ).toBe(false);
    expect(
      modelSupportsTurnRequirements(model, {
        reasoning: false,
        vision: false,
        tools: true,
      }),
    ).toBe(false);
    expect(
      modelSupportsTurnRequirements(model, {
        reasoning: false,
        vision: false,
        localOnly: true,
      }),
    ).toBe(false);
    expect(
      modelSupportsTurnRequirements(model, {
        reasoning: false,
        vision: false,
        minContextWindow: 200_000,
      }),
    ).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import type { BaseModel } from "../features/types";
import {
  reasoningModeFromPolicy,
  reasoningPolicyForComposerMode,
  selectedModelSupportsReasoning,
} from "./composer-reasoning-policy";

describe("composer reasoning policy", () => {
  it("maps explicit modes without inventing a raw or summary request", () => {
    expect(reasoningPolicyForComposerMode("default")).toBeUndefined();
    expect(reasoningPolicyForComposerMode("off")).toEqual({
      mode: "off",
      schemaVersion: 1,
    });
    expect(reasoningPolicyForComposerMode("high")).toEqual({
      effort: "high",
      mode: "auto",
      schemaVersion: 1,
    });
    expect(reasoningPolicyForComposerMode("automatic")).toEqual({
      mode: "auto",
      schemaVersion: 1,
    });
    expect(reasoningModeFromPolicy(reasoningPolicyForComposerMode("low"))).toBe(
      "low",
    );
    expect(
      reasoningModeFromPolicy(reasoningPolicyForComposerMode("medium")),
    ).toBe("medium");
  });

  it("requires an enabled, available model that advertises reasoning", () => {
    const model = {
      id: "model_reasoning",
      enabled: true,
      available: true,
      capabilities: { reasoning: true },
    } as BaseModel;
    expect(selectedModelSupportsReasoning([model], model.id)).toBe(true);
    expect(
      selectedModelSupportsReasoning(
        [{ ...model, available: false }],
        model.id,
      ),
    ).toBe(false);
    expect(selectedModelSupportsReasoning([model], "model_other")).toBe(false);
  });
});

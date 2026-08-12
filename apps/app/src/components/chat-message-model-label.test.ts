import { describe, expect, it } from "vitest";

import { resolveMessageModelLabel } from "./ChatMessages";

describe("resolveMessageModelLabel", () => {
  const names = {
    model_kimi: "Kimi K2.5",
    model_ds: "DeepSeek V3",
  };

  it("prefers the model persisted on the message", () => {
    expect(
      resolveMessageModelLabel({
        messageModelId: "model_kimi",
        modelDisplayNames: names,
        selectedModelId: "model_ds",
      }),
    ).toBe("Kimi K2.5");
  });

  it("falls back to the selected model while streaming without modelId", () => {
    expect(
      resolveMessageModelLabel({
        messageModelId: undefined,
        modelDisplayNames: names,
        selectedModelId: "model_ds",
      }),
    ).toBe("DeepSeek V3");
  });

  it("returns the raw id when the catalog has no display name", () => {
    expect(
      resolveMessageModelLabel({
        messageModelId: "model_unknown",
        modelDisplayNames: names,
        selectedModelId: undefined,
      }),
    ).toBe("model_unknown");
  });

  it("returns undefined when nothing is known", () => {
    expect(
      resolveMessageModelLabel({
        messageModelId: undefined,
        modelDisplayNames: names,
        selectedModelId: undefined,
      }),
    ).toBeUndefined();
  });
});

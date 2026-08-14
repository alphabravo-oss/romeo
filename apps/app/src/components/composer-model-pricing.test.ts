import { describe, expect, it } from "vitest";

import { formatModelPricing } from "./ComposerModelSelect";

describe("model selection price transparency", () => {
  it("shows input and output token prices per million", () => {
    expect(
      formatModelPricing({
        inputTokenUsd: 0.0000005,
        outputTokenUsd: 0.0000015,
      }),
    ).toBe("$0.5/$1.5 per 1M");
  });
});

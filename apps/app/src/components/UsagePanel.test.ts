import { describe, expect, it } from "vitest";

import type { UsageSummaryMetric } from "../features/operational-governance/types";
import { tokenQuantity } from "./UsagePanel";

describe("usage panel token evidence", () => {
  it("does not add reported reasoning to a provider total", () => {
    expect(
      tokenQuantity([
        metric("llm.total_token.reported", 150),
        metric("llm.reasoning_token.reported", 20),
      ]),
    ).toBe(150);
  });

  it("does not add reported reasoning to input and output components", () => {
    expect(
      tokenQuantity([
        metric("llm.input_token.reported", 120),
        metric("llm.output_token.reported", 30),
        metric("llm.reasoning_token.reported", 20),
      ]),
    ).toBe(150);
  });
});

function metric(metricCode: string, quantity: number): UsageSummaryMetric {
  return {
    metric: metricCode,
    quantity,
    unit: "token",
    estimatedCostUsd: 0,
  };
}

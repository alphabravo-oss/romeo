import { describe, expect, it } from "vitest";

import {
  UsageMetricCodes,
  UsageMetricCodeSchema,
  UsageUnitCodes,
  UsageUnitCodeSchema,
} from "./usage-metrics";

describe("usage metric contract", () => {
  it("publishes a unique, exact metric vocabulary", () => {
    expect(UsageMetricCodes).toHaveLength(48);
    expect(new Set(UsageMetricCodes).size).toBe(UsageMetricCodes.length);
    expect(UsageMetricCodeSchema.parse("llm.reasoning_token.reported")).toBe(
      "llm.reasoning_token.reported",
    );
    expect(() => UsageMetricCodeSchema.parse("provider.raw_tokens")).toThrow(
      "Invalid option",
    );
    expect(new Set(UsageUnitCodes).size).toBe(UsageUnitCodes.length);
    expect(UsageUnitCodeSchema.parse("micro_usd")).toBe("micro_usd");
    expect(() => UsageUnitCodeSchema.parse("count")).toThrow("Invalid option");
  });
});

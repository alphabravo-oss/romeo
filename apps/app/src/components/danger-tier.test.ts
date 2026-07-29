import { describe, expect, it } from "vitest";

import { confirmTone, requiresTypedConfirmation } from "./danger-tier";

describe("danger tiers", () => {
  it("requires typed confirmation only for high-severity actions", () => {
    expect(requiresTypedConfirmation("high")).toBe(true);
    expect(requiresTypedConfirmation("medium")).toBe(false);
    expect(requiresTypedConfirmation("low")).toBe(false);
  });

  it("uses the danger tone for high and medium severity", () => {
    expect(confirmTone("high")).toBe("danger");
    expect(confirmTone("medium")).toBe("danger");
  });

  it("uses the default tone for low severity so reversible actions stay light", () => {
    expect(confirmTone("low")).toBe("default");
  });
});

import { describe, expect, it } from "vitest";

import { parsePromptTemplateTags } from "./prompt-template-fields";

describe("parsePromptTemplateTags", () => {
  it("accepts comma-separated and newline-separated tags together", () => {
    expect(parsePromptTemplateTags("operations, incident\npriority")).toEqual([
      "operations",
      "incident",
      "priority",
    ]);
  });

  it("trims tags and removes empty fragments", () => {
    expect(parsePromptTemplateTags("  alpha, ,\n beta \n")).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("keeps author casing and duplicates for server normalization", () => {
    expect(parsePromptTemplateTags("Ops, ops")).toEqual(["Ops", "ops"]);
  });
});

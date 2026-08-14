import { describe, expect, it } from "vitest";

import {
  defaultStarterSuggestions,
  suggestionSubtitle,
} from "./chat-suggestions";

describe("chat suggestion cards", () => {
  it("takes the first non-empty line as the subtitle", () => {
    expect(suggestionSubtitle("\n\n  Compare the two plans  \nmore text")).toBe(
      "Compare the two plans",
    );
  });

  it("strips markdown heading marks", () => {
    expect(suggestionSubtitle("## Quarterly summary\nbody")).toBe(
      "Quarterly summary",
    );
    expect(suggestionSubtitle("> ### Quoted heading")).toBe("Quoted heading");
  });

  it("leaves a hash that is not a heading alone", () => {
    expect(suggestionSubtitle("#1 priority")).toBe("#1 priority");
  });

  it("has nothing to show for an empty prompt", () => {
    expect(suggestionSubtitle("   \n\n")).toBe("");
  });

  it("provides distinct outcome-oriented defaults", () => {
    const suggestions = defaultStarterSuggestions((key) => key);

    expect(suggestions).toHaveLength(4);
    expect(
      new Set(suggestions.map((suggestion) => suggestion.title)).size,
    ).toBe(suggestions.length);
    expect(
      suggestions.every((suggestion) => suggestion.prompt.length > 0),
    ).toBe(true);
  });
});

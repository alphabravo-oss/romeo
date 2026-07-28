import { describe, expect, it } from "vitest";

import { resolveThemeSelection } from "./theme-preference";

describe("resolveThemeSelection", () => {
  it("takes the server value on first load", () => {
    expect(
      resolveThemeSelection({
        serverTheme: "dark",
        localTheme: "light",
        hasSeeded: false,
      }),
    ).toBe("dark");
  });

  it("does not overwrite local state after the first seed", () => {
    expect(
      resolveThemeSelection({
        serverTheme: "dark",
        localTheme: "light",
        hasSeeded: true,
      }),
    ).toBe("light");
  });

  it("does not overwrite local state with an unavailable server value", () => {
    expect(
      resolveThemeSelection({
        serverTheme: undefined,
        localTheme: "system",
        hasSeeded: false,
      }),
    ).toBe("system");
  });
});

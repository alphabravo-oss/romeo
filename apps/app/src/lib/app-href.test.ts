import { describe, expect, it } from "vitest";

import { appHref } from "./app-href";

describe("appHref", () => {
  it("creates stable, encoded, shareable links without empty parameters", () => {
    expect(
      appHref("/admin", {
        query: "voice & video",
        section: "providers",
        selected: undefined,
      }),
    ).toBe("/admin?query=voice+%26+video&section=providers");
  });
});

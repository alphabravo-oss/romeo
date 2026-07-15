import { describe, expect, it } from "vitest";

import { parseArgs } from "./args";
import { resolveConfig } from "./config";

describe("resolveConfig", () => {
  it("ignores empty environment values", () => {
    expect(
      resolveConfig(parseArgs([]), {
        ROMEO_BASE_URL: "",
        ROMEO_API_KEY: "",
      }),
    ).toEqual({
      baseUrl: "http://127.0.0.1:3000",
    });
  });

  it("uses explicit non-empty API settings", () => {
    expect(
      resolveConfig(
        parseArgs([
          "--base-url",
          "https://romeo.example",
          "--api-key",
          "rmk_test",
        ]),
        {},
      ),
    ).toEqual({
      baseUrl: "https://romeo.example",
      apiKey: "rmk_test",
    });
  });
});

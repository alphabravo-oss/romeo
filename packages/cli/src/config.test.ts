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

  it("uses explicit non-empty API settings from the environment", () => {
    expect(
      resolveConfig(parseArgs(["--base-url", "https://romeo.example"]), {
        ROMEO_API_KEY: "rmk_test",
      }),
    ).toEqual({
      baseUrl: "https://romeo.example",
      apiKey: "rmk_test",
    });
  });

  it("rejects API keys passed on argv", () => {
    expect(() =>
      resolveConfig(parseArgs(["--api-key", "rmk_leaked"]), {}),
    ).toThrow("forbidden");
  });
});

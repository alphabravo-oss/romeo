import { describe, expect, it } from "vitest";

import { isLoopbackHostname, isLoopbackOrigin, readEnv } from "./index";

describe("DEV_SEEDED_LOGIN loopback confinement", () => {
  it("allows the seeded login only on a loopback APP_ORIGIN", () => {
    for (const origin of [
      "http://localhost:3000",
      "http://127.0.0.1:12049",
      "http://[::1]:3000",
    ]) {
      expect(
        readEnv({ APP_ORIGIN: origin, DEV_SEEDED_LOGIN: "true" })
          .DEV_SEEDED_LOGIN,
      ).toBe(true);
    }
    for (const origin of [
      "https://romeo.example.com",
      "http://192.168.1.20:3000",
      "http://localhost.example.com:3000",
      "http://app.localhost:3000",
    ]) {
      expect(() =>
        readEnv({ APP_ORIGIN: origin, DEV_SEEDED_LOGIN: "true" }),
      ).toThrow(/DEV_SEEDED_LOGIN requires a loopback APP_ORIGIN/u);
      expect(
        readEnv({ APP_ORIGIN: origin, DEV_SEEDED_LOGIN: "false" })
          .DEV_SEEDED_LOGIN,
      ).toBe(false);
    }
  });

  it("recognizes only loopback hostnames", () => {
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("LOCALHOST.")).toBe(true);
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("127.10.20.30")).toBe(true);
    expect(isLoopbackHostname("[::1]")).toBe(true);
    expect(isLoopbackHostname("127.0.0.1.nip.io")).toBe(false);
    expect(isLoopbackHostname("0.0.0.0")).toBe(false);
    expect(isLoopbackHostname("10.0.0.1")).toBe(false);
    expect(isLoopbackOrigin("not a url")).toBe(false);
  });
});

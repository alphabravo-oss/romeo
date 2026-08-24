import { describe, expect, it } from "vitest";

import { createRomeoApi } from "../api";
import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { testEnv } from "../test-support/env";

function rateLimitedApi() {
  return createRomeoApi(new InMemoryRomeoRepository(), {
    env: testEnv({
      EDGE_TRUSTED_PROXY_CIDRS: "10.42.0.0/16",
      EDGE_TRUSTED_PROXY_MODE: "trusted_proxy",
      HTTP_RATE_LIMIT_DRIVER: "memory",
      HTTP_RATE_LIMIT_PUBLIC_MAX: "1",
    }),
  });
}

describe("trusted proxy rate-limit identity", () => {
  it("does not let an untrusted peer rotate spoofed forwarded addresses", async () => {
    const app = rateLimitedApi();
    const first = await app.request(
      "/api/config",
      { headers: { "x-forwarded-for": "198.51.100.1" } },
      { requestPeerAddress: "203.0.113.50" },
    );
    const second = await app.request(
      "/api/config",
      { headers: { "x-forwarded-for": "198.51.100.2" } },
      { requestPeerAddress: "203.0.113.50" },
    );

    expect(first.status).toBe(404);
    expect(second.status).toBe(429);
  });

  it("keys validated forwarded clients independently behind a trusted peer", async () => {
    const app = rateLimitedApi();
    const first = await app.request(
      "/api/config",
      { headers: { "x-forwarded-for": "198.51.100.1" } },
      { requestPeerAddress: "10.42.3.5" },
    );
    const second = await app.request(
      "/api/config",
      { headers: { "x-forwarded-for": "198.51.100.2" } },
      { requestPeerAddress: "10.42.3.5" },
    );

    expect(first.status).toBe(404);
    expect(second.status).toBe(404);
  });
});

import { describe, expect, it } from "vitest";

import { createRomeoApi } from "../api";
import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { testEnv } from "../test-support/env";

function seededApi(overrides: Record<string, string> = {}) {
  return createRomeoApi(new InMemoryRomeoRepository(), {
    env: testEnv(overrides),
  });
}

function createKey(
  api: ReturnType<typeof seededApi>,
  headers: Record<string, string> = {},
  url = "/api/v1/api-keys",
) {
  return api.request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ name: "seeded", scopes: ["me:read"] }),
  });
}

describe("development seeded login confinement", () => {
  it("grants the seeded subject only to loopback hosts", async () => {
    const api = seededApi();

    const local = await api.request("/api/v1/me");
    expect(local.status).toBe(200);
    expect((await local.json()).subject.adminRole).toBe("global_admin");
    expect((await api.request("http://127.0.0.1:3000/api/v1/me")).status).toBe(
      200,
    );
    expect((await api.request("http://[::1]:3000/api/v1/me")).status).toBe(200);

    // A DNS-rebinding page reaches the server under its own host name.
    expect(
      (await api.request("http://rebind.attacker.example/api/v1/me")).status,
    ).toBe(401);
    expect(
      (
        await api.request("/api/v1/me", {
          headers: { host: "rebind.attacker.example:3000" },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await api.request("http://192.168.1.20:3000/api/v1/me", {
          headers: { host: "192.168.1.20:3000" },
        })
      ).status,
    ).toBe(401);
  });

  it("rejects cross-site browser mutations without any session cookie", async () => {
    const api = seededApi();

    const crossOrigin = await createKey(api, {
      origin: "https://attacker.example",
    });
    expect(crossOrigin.status).toBe(403);
    expect((await crossOrigin.json()).error.code).toBe("csrf_origin_mismatch");

    const crossSite = await createKey(api, { "sec-fetch-site": "cross-site" });
    expect(crossSite.status).toBe(403);

    const crossReferer = await createKey(api, {
      referer: "https://attacker.example/page",
    });
    expect(crossReferer.status).toBe(403);

    expect(
      (await createKey(api, { origin: "http://localhost:3000" })).status,
    ).toBe(201);
    expect(
      (await createKey(api, { origin: "http://127.0.0.1:12049" })).status,
    ).toBe(201);
    // Non-browser clients (no provenance headers at all) keep working.
    expect((await createKey(api)).status).toBe(201);
  });

  it("does not add CSRF requirements when the seeded login is disabled", async () => {
    const api = seededApi({ DEV_SEEDED_LOGIN: "false" });
    const response = await createKey(api, {
      origin: "https://attacker.example",
    });
    expect(response.status).toBe(401);
  });
});

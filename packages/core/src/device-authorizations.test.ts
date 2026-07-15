import { describe, expect, it } from "vitest";
import { readEnv } from "@romeo/config";

import { createRomeoApi } from "./api";
import { InMemoryRomeoRepository } from "./repositories/in-memory";

describe("device authorization API", () => {
  it("creates, refreshes, and revokes refreshable device credentials", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const createResponse = await api.request("/api/v1/device-authorizations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "MacBook",
        scopes: ["me:read", "chats:read"],
        ttlDays: 30,
      }),
    });
    const created = await createResponse.json();
    const listResponse = await api.request("/api/v1/device-authorizations");
    const list = await listResponse.json();
    const meWithAccessResponse = await api.request("/api/v1/me", {
      headers: { authorization: `Bearer ${created.data.accessToken}` },
    });
    const meWithAccess = await meWithAccessResponse.json();

    const refreshResponse = await api.request(
      "/api/v1/device-authorizations/refresh",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: created.data.refreshToken }),
      },
    );
    const refreshed = await refreshResponse.json();
    const oldAccessResponse = await api.request("/api/v1/me", {
      headers: { authorization: `Bearer ${created.data.accessToken}` },
    });
    const oldRefreshResponse = await api.request(
      "/api/v1/device-authorizations/refresh",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: created.data.refreshToken }),
      },
    );
    const newAccessResponse = await api.request("/api/v1/me", {
      headers: { authorization: `Bearer ${refreshed.data.accessToken}` },
    });

    const revokeResponse = await api.request(
      `/api/v1/device-authorizations/${created.data.authorization.id}/revoke`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${refreshed.data.accessToken}` },
      },
    );
    const revoked = await revokeResponse.json();
    const revokedAccessResponse = await api.request("/api/v1/me", {
      headers: { authorization: `Bearer ${refreshed.data.accessToken}` },
    });
    const revokedRefreshResponse = await api.request(
      "/api/v1/device-authorizations/refresh",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: refreshed.data.refreshToken }),
      },
    );

    expect(createResponse.status).toBe(201);
    expect(created.data.accessToken).toMatch(/^rmk_[a-f0-9]{48}$/);
    expect(created.data.refreshToken).toMatch(/^rmr_[a-f0-9]{48}$/);
    expect(created.data.authorization).not.toHaveProperty("hashedRefreshToken");
    expect(created.data.authorization.scopes).toEqual([
      "me:read",
      "chats:read",
    ]);
    expect(listResponse.status).toBe(200);
    expect(list.data).toHaveLength(1);
    expect(meWithAccessResponse.status).toBe(200);
    expect(meWithAccess.subject.apiKeyId).toBe(
      created.data.authorization.accessApiKeyId,
    );
    expect(refreshResponse.status).toBe(200);
    expect(refreshed.data.accessToken).not.toBe(created.data.accessToken);
    expect(refreshed.data.refreshToken).not.toBe(created.data.refreshToken);
    expect(refreshed.data.authorization.accessApiKeyId).not.toBe(
      created.data.authorization.accessApiKeyId,
    );
    expect(oldAccessResponse.status).toBe(403);
    expect(oldRefreshResponse.status).toBe(403);
    expect(newAccessResponse.status).toBe(200);
    expect(revokeResponse.status).toBe(200);
    expect(revoked.data.revokedAt).toBeDefined();
    expect(revokedAccessResponse.status).toBe(403);
    expect(revokedRefreshResponse.status).toBe(403);
  });

  it("rejects device scopes that exceed the caller scopes", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const createResponse = await api.request("/api/v1/device-authorizations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Limited client", scopes: ["me:read"] }),
    });
    const created = await createResponse.json();

    const exceededResponse = await api.request(
      "/api/v1/device-authorizations",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${created.data.accessToken}`,
        },
        body: JSON.stringify({
          name: "Escalation attempt",
          scopes: ["admin:write"],
        }),
      },
    );
    const exceeded = await exceededResponse.json();

    expect(createResponse.status).toBe(201);
    expect(exceededResponse.status).toBe(400);
    expect(exceeded.error.code).toBe("device_authorization_scope_exceeded");
  });

  it("refreshes device credentials without an existing access token in secure mode", async () => {
    const repository = new InMemoryRomeoRepository();
    const setupApi = createRomeoApi(repository);
    const secureApi = createRomeoApi(repository, {
      env: readEnv({ DEV_SEEDED_LOGIN: "false" }),
    });
    const createResponse = await setupApi.request(
      "/api/v1/device-authorizations",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Native client",
          scopes: ["me:read"],
          ttlDays: 30,
        }),
      },
    );
    const created = await createResponse.json();

    const refreshResponse = await secureApi.request(
      "/api/v1/device-authorizations/refresh",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken: created.data.refreshToken }),
      },
    );
    const refreshed = await refreshResponse.json();
    const oldAccessResponse = await secureApi.request("/api/v1/me", {
      headers: { authorization: `Bearer ${created.data.accessToken}` },
    });
    const newAccessResponse = await secureApi.request("/api/v1/me", {
      headers: { authorization: `Bearer ${refreshed.data.accessToken}` },
    });

    expect(createResponse.status).toBe(201);
    expect(refreshResponse.status).toBe(200);
    expect(refreshed.data.accessToken).toMatch(/^rmk_[a-f0-9]{48}$/);
    expect(refreshed.data.refreshToken).toMatch(/^rmr_[a-f0-9]{48}$/);
    expect(oldAccessResponse.status).toBe(403);
    expect(newAccessResponse.status).toBe(200);
  });
});

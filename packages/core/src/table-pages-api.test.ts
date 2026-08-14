import { describe, expect, it } from "vitest";

import { createRomeoApi } from "./api";
import { InMemoryRomeoRepository } from "./repositories/in-memory";
import { SessionService } from "./services/session-service";
import { testEnv } from "./test-support/env";

describe("inventoried table page HTTP", () => {
  it("pages API keys with a signed cursor and rejects tamper and tenant replay", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: testEnv(),
    });
    for (const name of ["page-test-alpha", "page-test-bravo", "page-test-charlie"]) {
      const created = await api.request("/api/v1/api-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, scopes: ["me:read"] }),
      });
      expect(created.status).toBe(201);
    }

    const first = await api.request("/api/v1/admin/table-pages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        resource: "api_keys",
        limit: 2,
        search: "page-test",
        sort: [{ field: "name", direction: "asc" }],
      }),
    });
    expect(first.status).toBe(200);
    const firstPage = (await first.json()).data;
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.items.map((row: { name: string }) => row.name)).toEqual([
      "page-test-alpha",
      "page-test-bravo",
    ]);
    expect(firstPage.items[0].hashedToken).toBeUndefined();
    expect(firstPage.page.estimatedTotal).toBeGreaterThanOrEqual(3);
    expect(typeof firstPage.page.nextCursor).toBe("string");
    expect(firstPage.summary).toMatchObject({ total: expect.any(Number) });

    const second = await api.request("/api/v1/admin/table-pages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        resource: "api_keys",
        cursor: firstPage.page.nextCursor,
        limit: 2,
        search: "page-test",
        sort: [{ field: "name", direction: "asc" }],
      }),
    });
    expect(second.status).toBe(200);
    const secondPage = (await second.json()).data;
    expect(secondPage.items.map((row: { name: string }) => row.name)).toContain(
      "page-test-charlie",
    );

    const tampered = await api.request("/api/v1/admin/table-pages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        resource: "api_keys",
        cursor: `${firstPage.page.nextCursor}x`,
        limit: 2,
        search: "page-test",
        sort: [{ field: "name", direction: "asc" }],
      }),
    });
    expect(tampered.status).toBe(400);
    expect(await tampered.json()).toMatchObject({
      error: { code: "invalid_page_cursor" },
    });

    const reshaped = await api.request("/api/v1/admin/table-pages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        resource: "api_keys",
        cursor: firstPage.page.nextCursor,
        limit: 2,
        search: "page-test",
        sort: [{ field: "createdAt", direction: "desc" }],
      }),
    });
    expect(reshaped.status).toBe(400);

    const unknownSort = await api.request("/api/v1/admin/table-pages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        resource: "api_keys",
        sort: [{ field: "scopes", direction: "asc" }],
      }),
    });
    expect(unknownSort.status).toBe(400);
    expect(await unknownSort.json()).toMatchObject({
      error: { code: "invalid_request" },
    });
  });

  it("pages impersonation requests, sessions, and export packages from the real loaders", async () => {
    const repository = new InMemoryRomeoRepository();
    const api = createRomeoApi(repository, { env: testEnv() });
    await repository.createUser({
      email: "page-target@example.com",
      id: "user_page_target",
      name: "Page Target",
      orgId: "org_default",
    });
    await repository.createUser({
      email: "page-approver@example.com",
      id: "user_page_approver",
      name: "Page Approver",
      orgId: "org_default",
      role: "org_admin",
    });
    const sessions = new SessionService(repository);
    const request = await sessions.requestSupportSession({
      confirmTargetUserId: "user_page_target",
      reason: "Table page loader verification",
      subject: {
        groupIds: ["group_admins"],
        id: "user_dev_admin",
        isAdmin: true,
        orgId: "org_default",
        scopes: ["admin:read", "admin:write"],
        type: "user",
        workspaceIds: ["workspace_default"],
      },
      targetUserId: "user_page_target",
      ticketRef: "PAGE-1",
      ttlMinutes: 20,
    });

    const pending = await api.request("/api/v1/admin/table-pages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resource: "support_access_requests" }),
    });
    expect(pending.status).toBe(200);
    const pendingPage = (await pending.json()).data;
    expect(pendingPage.items[0]).toMatchObject({
      id: request.id,
      status: "pending",
      targetUserId: "user_page_target",
      ttlMinutes: 20,
    });
    expect(pendingPage.items[0].email).toBeUndefined();

    const created = await sessions.approveSupportSessionRequest({
      requestId: request.id,
      subject: {
        groupIds: ["group_admins"],
        id: "user_page_approver",
        isAdmin: true,
        orgId: "org_default",
        scopes: ["admin:read", "admin:write"],
        type: "user",
        workspaceIds: ["workspace_default"],
      },
    });

    const sessionPage = await api.request("/api/v1/admin/table-pages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resource: "support_sessions" }),
    });
    expect(sessionPage.status).toBe(200);
    const sessionsData = (await sessionPage.json()).data;
    expect(sessionsData.items[0]).toMatchObject({
      id: created.session.id,
      status: "active",
      targetUserId: "user_page_target",
    });
    expect(sessionsData.items[0].session).toMatchObject({
      id: created.session.id,
    });

    const packages = await api.request("/api/v1/admin/table-pages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resource: "governance_export_packages" }),
    });
    expect(packages.status).toBe(200);
    expect(Array.isArray((await packages.json()).data.items)).toBe(true);
  });

  it("rejects an unknown resource", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: testEnv(),
    });
    const response = await api.request("/api/v1/admin/table-pages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resource: "not_a_table" }),
    });
    expect(response.status).toBe(404);
  });
});

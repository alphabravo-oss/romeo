import { describe, expect, it } from "vitest";

import { createRomeoApi } from "./api";
import { InMemoryRomeoRepository } from "./repositories/in-memory";

describe("admin user server-table API", () => {
  it("returns the shared envelope and follows an opaque cursor", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createUser({
      email: "alpha@example.com",
      id: "user_alpha_api",
      name: "Alpha API User",
      orgId: "org_default",
    });
    const api = createRomeoApi(repository);
    const firstResponse = await queryUsers(api, {
      filters: [],
      limit: 1,
      sort: [{ direction: "asc", field: "name" }],
    });
    const first = await firstResponse.json();

    expect(firstResponse.status).toBe(200);
    expect(first.data.items[0]?.id).toBe("user_alpha_api");
    expect(first.data.page).toMatchObject({
      estimatedTotal: 2,
      limit: 1,
      previousCursor: null,
    });
    expect(first.data.page.nextCursor).toEqual(expect.any(String));
    expect(first.data.summary).toMatchObject({
      activeGlobalAdminTotal: 1,
      userTotal: 2,
    });

    const secondResponse = await queryUsers(api, {
      cursor: first.data.page.nextCursor,
      filters: [],
      limit: 1,
      sort: [{ direction: "asc", field: "name" }],
    });
    const second = await secondResponse.json();
    expect(secondResponse.status).toBe(200);
    expect(second.data.items[0]?.id).toBe("user_dev_admin");
    expect(second.data.page.nextCursor).toBeNull();
  });

  it("rejects short search and disallowed sort/filter fields at the contract", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    for (const body of [
      {
        filters: [],
        limit: 50,
        search: "ad",
        sort: [{ direction: "asc", field: "name" }],
      },
      {
        filters: [],
        limit: 50,
        sort: [{ direction: "asc", field: "orgId" }],
      },
      {
        filters: [{ field: "email", operator: "contains", value: "@" }],
        limit: 50,
        sort: [{ direction: "asc", field: "name" }],
      },
    ]) {
      expect((await queryUsers(api, body)).status).toBe(400);
    }
  });
});

function queryUsers(
  api: ReturnType<typeof createRomeoApi>,
  body: Record<string, unknown>,
) {
  return api.request("/api/v1/users/query", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

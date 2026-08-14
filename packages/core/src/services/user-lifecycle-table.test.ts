import type { AuthSubject } from "@romeo/auth";
import { beforeEach, describe, expect, it } from "vitest";

import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { UserLifecycleService } from "./user-lifecycle-service";
import type { UserTableQueryRequest } from "./user-table-query";

const cursorSecrets = ["admin-user-table-test-cursor-secret-000001"] as const;
const admin: AuthSubject = {
  groupIds: [],
  id: "user_dev_admin",
  orgId: "org_default",
  scopes: ["admin:read"],
  type: "user",
  workspaceIds: ["workspace_default"],
};

describe("UserLifecycleService server table", () => {
  let repository: InMemoryRomeoRepository;
  let service: UserLifecycleService;

  beforeEach(async () => {
    repository = new InMemoryRomeoRepository();
    service = new UserLifecycleService(repository, { cursorSecrets });
    await repository.createUser({
      email: "beta@example.com",
      id: "user_beta",
      name: "Beta User",
      orgId: admin.orgId,
      role: "user",
    });
    await repository.createUser({
      email: "delta@example.com",
      id: "user_delta",
      name: "Delta User",
      orgId: admin.orgId,
      role: "org_admin",
    });
    await repository.createUser({
      email: "private@example.com",
      id: "user_other_org",
      name: "Private Other Tenant",
      orgId: "org_other",
      role: "global_admin",
    });
  });

  it("uses a stable keyset and never crosses the mandatory tenant predicate", async () => {
    const first = await service.queryTable(admin, request({ limit: 1 }));
    expect(first.data.items[0]?.id).toBe("user_beta");
    expect(first.data.items.map((user) => user.id)).not.toContain(
      "user_other_org",
    );
    expect(first.data.page.nextCursor).not.toBeNull();

    await repository.createUser({
      email: "alpha@example.com",
      id: "user_inserted_before_cursor",
      name: "Alpha User",
      orgId: admin.orgId,
    });
    const second = await service.queryTable(
      admin,
      request({ cursor: first.data.page.nextCursor!, limit: 2 }),
    );
    expect(second.data.items.map((user) => user.id)).toEqual([
      "user_delta",
      "user_dev_admin",
    ]);
  });

  it("applies bounded search and role/status filters with summary isolation", async () => {
    const page = await service.queryTable(
      admin,
      request({
        filters: [
          { field: "role", operator: "in", value: ["org_admin", "user"] },
          { field: "status", operator: "eq", value: "active" },
        ],
        search: "example.com",
      }),
    );
    expect(page.data.items.map((user) => user.id)).toEqual([
      "user_beta",
      "user_delta",
    ]);
    expect(page.data.page.estimatedTotal).toBe(2);
    expect(page.data.summary.userTotal).toBe(3);
    expect(page.data.applied.filters).toHaveLength(2);
  });

  it("rejects stale, replayed, malformed, and unauthorized cursor access", async () => {
    const first = await service.queryTable(admin, request({ limit: 1 }));
    await expect(
      service.queryTable(
        admin,
        request({
          cursor: first.data.page.nextCursor!,
          search: "delta",
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid_page_cursor", status: 400 });
    await expect(
      service.queryTable(admin, request({ cursor: "not-a-cursor" })),
    ).rejects.toMatchObject({ code: "invalid_page_cursor", status: 400 });
    await expect(
      service.queryTable(
        { ...admin, scopes: ["me:read"] },
        request(),
      ),
    ).rejects.toBeDefined();
  });
});

function request(
  overrides: Partial<UserTableQueryRequest> = {},
): UserTableQueryRequest {
  return {
    filters: [],
    limit: 50,
    sort: [{ direction: "asc", field: "name" }],
    ...overrides,
  };
}

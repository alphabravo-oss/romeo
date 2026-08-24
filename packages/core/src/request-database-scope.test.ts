import type { AuthSubject } from "@romeo/auth";
import type { RepositoryRequestScope, RomeoRepository } from "./index";
import { describe, expect, it } from "vitest";

import { createRomeoApi } from "./api";
import { repositoryScopeForRequest } from "./http/request-context";
import { InMemoryRomeoRepository } from "./repositories/in-memory";
import { ApiKeyService } from "./services/api-key-service";
import { testEnv } from "./test-support/env";

describe("request-scoped repository boundary", () => {
  it("uses a short system authentication scope and tenant-scoped route repository", async () => {
    const repository = new InMemoryRomeoRepository();
    const scope = recordingScope(repository);
    const bootstrapApi = createRomeoApi(repository, {
      env: testEnv({ DEV_SEEDED_LOGIN: "true" }),
      repositoryRequestScope: scope,
      startBackgroundWorkers: false,
    });
    const createKey = await bootstrapApi.request("/api/v1/api-keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Scoped request key",
        scopes: ["admin:read"],
      }),
    });
    const keyBody = await createKey.json();
    expect(createKey.status).toBe(201);
    expect(scope.events).toEqual([
      "system:begin",
      "system:end",
      "tenant:org_default:begin",
      "tenant:org_default:end",
    ]);
    expect(scope.active()).toBeUndefined();

    scope.events.length = 0;
    const authenticatedApi = createRomeoApi(repository, {
      env: testEnv({ DEV_SEEDED_LOGIN: "false" }),
      repositoryRequestScope: scope,
      startBackgroundWorkers: false,
    });
    const response = await authenticatedApi.request("/api/v1/workspaces", {
      headers: { authorization: `Bearer ${keyBody.data.token}` },
    });

    expect(response.status).toBe(200);
    expect(scope.events).toEqual([
      "system:begin",
      "system:end",
      "tenant:org_default:begin",
      "tenant:org_default:end",
    ]);
    expect(scope.active()).toBeUndefined();
  });

  it("fails closed when the system boundary rejects a privileged login", async () => {
    const repository = new InMemoryRomeoRepository();
    const scope: RepositoryRequestScope = {
      runAsSystem: async () => {
        throw new Error("tenant_database_context_privileged_role_forbidden");
      },
      runAsTenant: async () => {
        throw new Error("tenant_scope_must_not_run");
      },
    };
    const api = createRomeoApi(repository, {
      env: testEnv({ DEV_SEEDED_LOGIN: "true" }),
      repositoryRequestScope: scope,
      startBackgroundWorkers: false,
    });

    const response = await api.request("/api/v1/workspaces");

    expect(response.status).toBe(500);
  });

  it("keeps concurrent tenant captures isolated while sharing process clients", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createOrganization({
      id: "org_tenant_b",
      name: "Tenant B",
      slug: "tenant-b",
    });
    await repository.createWorkspace({
      id: "workspace_tenant_b",
      name: "Tenant B workspace",
      orgId: "org_tenant_b",
      slug: "tenant-b",
    });
    await repository.createUser({
      email: "admin@tenant-b.test",
      id: "user_tenant_b",
      name: "Tenant B admin",
      orgId: "org_tenant_b",
    });
    await repository.createResourceGrant({
      id: "grant_tenant_b_workspace",
      permission: "read",
      principalId: "user_tenant_b",
      principalType: "user",
      resourceId: "workspace_tenant_b",
      resourceType: "workspace",
    });
    const apiKeys = new ApiKeyService(repository);
    const [tenantAKey, tenantBKey] = await Promise.all([
      apiKeys.create({
        name: "Tenant A request",
        scopes: ["workspaces:read"],
        subject: adminSubject("org_default", "user_dev_admin"),
      }),
      apiKeys.create({
        name: "Tenant B request",
        scopes: ["workspaces:read"],
        subject: adminSubject("org_tenant_b", "user_tenant_b"),
      }),
    ]);
    const tenantCaptures: string[] = [];
    const api = createRomeoApi(repository, {
      env: testEnv({ DEV_SEEDED_LOGIN: "false" }),
      repositoryRequestScope: {
        runAsSystem: (work) => work(repository),
        runAsTenant: async (orgId, work) => {
          tenantCaptures.push(orgId);
          await Promise.resolve();
          return work(repository);
        },
      },
      startBackgroundWorkers: false,
    });

    const [tenantAResponse, tenantBResponse] = await Promise.all([
      api.request("/api/v1/workspaces", {
        headers: { authorization: `Bearer ${tenantAKey.token}` },
      }),
      api.request("/api/v1/workspaces", {
        headers: { authorization: `Bearer ${tenantBKey.token}` },
      }),
    ]);
    const [tenantA, tenantB] = await Promise.all([
      tenantAResponse.json(),
      tenantBResponse.json(),
    ]);

    expect([tenantAResponse.status, tenantBResponse.status]).toEqual([
      200, 200,
    ]);
    expect(tenantCaptures.sort()).toEqual(["org_default", "org_tenant_b"]);
    expect(tenantA.data.map((item: { id: string }) => item.id)).toEqual([
      "workspace_default",
    ]);
    expect(tenantB.data.map((item: { id: string }) => item.id)).toEqual([
      "workspace_tenant_b",
    ]);
  });

  it("runs only exact global-admin platform operations in coordinator scope", async () => {
    const repository = new InMemoryRomeoRepository();
    const scope = recordingScope(repository);
    const api = createRomeoApi(repository, {
      env: testEnv({ DEV_SEEDED_LOGIN: "true" }),
      repositoryRequestScope: scope,
      startBackgroundWorkers: false,
    });

    const list = await api.request("/api/v1/admin/organizations");
    expect(list.status).toBe(200);
    expect(scope.events.slice(-2)).toEqual(["system:begin", "system:end"]);

    const create = await api.request("/api/v1/admin/organizations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Scoped tenant", slug: "scoped-tenant" }),
    });
    expect(create.status).toBe(201);

    const suspend = await api.request(
      "/api/v1/admin/organizations/org_scoped_tenant/suspend",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirmOrgId: "org_scoped_tenant",
          reasonCode: "security_review",
        }),
      },
    );
    expect(suspend.status).toBe(200);

    const deletion = await api.request(
      "/api/v1/admin/organizations/org_scoped_tenant/deletion-request",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirmOrgId: "org_scoped_tenant",
          reasonCode: "customer_request",
        }),
      },
    );
    expect(deletion.status).toBe(200);
    expect(
      scope.events.filter((event) => event === "tenant:org_default:begin"),
    ).toHaveLength(0);
    expect(scope.active()).toBeUndefined();
  });

  it("keeps org admins, spoofed platform paths, and ordinary global-admin routes tenant scoped", () => {
    const globalAdmin: AuthSubject = {
      id: "global",
      type: "user",
      orgId: "org_default",
      workspaceIds: ["workspace_default"],
      groupIds: [],
      scopes: ["admin:read", "admin:write"],
      adminRole: "global_admin",
    };
    const orgAdmin: AuthSubject = {
      ...globalAdmin,
      adminRole: "org_admin",
    };

    expect(
      repositoryScopeForRequest(
        globalAdmin,
        "GET",
        "/api/v1/admin/organizations",
      ),
    ).toBe("system");
    expect(
      repositoryScopeForRequest(
        globalAdmin,
        "GET",
        "/api/v1/admin/runtime-key-rotation/posture",
      ),
    ).toBe("system");
    expect(
      repositoryScopeForRequest(orgAdmin, "GET", "/api/v1/admin/organizations"),
    ).toBe("tenant");
    expect(
      repositoryScopeForRequest(
        globalAdmin,
        "DELETE",
        "/api/v1/admin/organizations/org_other",
      ),
    ).toBe("tenant");
    expect(
      repositoryScopeForRequest(
        globalAdmin,
        "GET",
        "/api/v1/admin/organizations/org_other/suspend/extra",
      ),
    ).toBe("tenant");
    expect(
      repositoryScopeForRequest(globalAdmin, "GET", "/api/v1/workspaces"),
    ).toBe("tenant");
  });
});

function adminSubject(orgId: string, id: string): AuthSubject {
  return {
    adminRole: "org_admin",
    groupIds: [],
    id,
    isAdmin: true,
    orgId,
    scopes: ["admin:write"],
    type: "user",
    workspaceIds: [],
  };
}

function recordingScope(repository: RomeoRepository): RepositoryRequestScope & {
  active: () => string | undefined;
  events: string[];
} {
  const events: string[] = [];
  let active: string | undefined;
  const run = <T>(
    label: string,
    work: (repository: RomeoRepository) => Promise<T>,
  ) =>
    repository.transaction(async (transaction) => {
      if (active !== undefined) throw new Error("repository_scope_nested");
      active = label;
      events.push(`${label}:begin`);
      try {
        return await work(transaction);
      } finally {
        events.push(`${label}:end`);
        active = undefined;
      }
    });
  return {
    active: () => active,
    events,
    runAsSystem: (work) => run("system", work),
    runAsTenant: (orgId, work) => run(`tenant:${orgId}`, work),
  };
}

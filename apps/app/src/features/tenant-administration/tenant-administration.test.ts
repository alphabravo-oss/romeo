import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  tenantAdministrationListOrganizations: vi.fn(),
  tenantAdministrationCreateOrganization: vi.fn(),
  tenantAdministrationUpdateOrganization: vi.fn(),
  tenantAdministrationSuspendOrganization: vi.fn(),
  tenantAdministrationReactivateOrganization: vi.fn(),
}));

vi.mock("@romeo/api-client/generated/sdk", () => sdk);
vi.mock("@romeo/api-client/runtime/browser", () => ({
  configureBrowserApiClients: vi.fn(),
}));

import {
  buildCreateTenantOrganizationBody,
  createTenantOrganization,
  isValidTenantReasonCode,
  listTenantOrganizations,
  reactivateTenantOrganization,
  suspendTenantOrganization,
  updateTenantOrganization,
} from "./index";

const summary = {
  organization: {
    id: "org_1",
    name: "Acme",
    slug: "acme",
  },
  counts: {
    activeApiKeys: 1,
    disabledUsers: 0,
    serviceAccounts: 0,
    users: 2,
    workspaces: 1,
  },
  suspension: { suspended: false },
};

describe("buildCreateTenantOrganizationBody", () => {
  it("requires name and omits empty optionals", () => {
    expect(
      buildCreateTenantOrganizationBody({
        name: "  Acme  ",
        slug: "  ",
        initialAdminEmail: "a@b.com",
      }),
    ).toEqual({ name: "Acme" });
  });

  it("includes slug, workspace, and admin when provided", () => {
    expect(
      buildCreateTenantOrganizationBody({
        name: "Acme",
        slug: "acme",
        defaultWorkspaceName: "Main",
        initialAdminEmail: "admin@acme.test",
        initialAdminName: "Admin",
        initialAdminPassword: "password-long",
      }),
    ).toEqual({
      name: "Acme",
      slug: "acme",
      defaultWorkspace: { name: "Main" },
      initialAdmin: {
        email: "admin@acme.test",
        name: "Admin",
        password: "password-long",
      },
    });
  });
});

describe("isValidTenantReasonCode", () => {
  it("accepts contract-safe codes", () => {
    expect(isValidTenantReasonCode("admin_ui_suspend")).toBe(true);
    expect(isValidTenantReasonCode("billing:nonpay")).toBe(true);
  });

  it("rejects empty or illegal characters", () => {
    expect(isValidTenantReasonCode("")).toBe(false);
    expect(isValidTenantReasonCode("bad reason")).toBe(false);
  });
});

describe("tenant-administration feature wrappers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists organizations via tenantAdministration.listOrganizations", async () => {
    sdk.tenantAdministrationListOrganizations.mockResolvedValue({
      data: { data: [summary] },
    });
    await expect(listTenantOrganizations()).resolves.toEqual([summary]);
    expect(sdk.tenantAdministrationListOrganizations).toHaveBeenCalledWith({
      throwOnError: true,
    });
  });

  it("creates with the create body shape", async () => {
    const body = buildCreateTenantOrganizationBody({
      name: "Beta",
      slug: "beta",
    });
    sdk.tenantAdministrationCreateOrganization.mockResolvedValue({
      data: {
        data: {
          ...summary,
          organization: { ...summary.organization, name: "Beta", slug: "beta" },
          defaultWorkspace: {
            id: "ws_1",
            orgId: "org_1",
            name: "Default",
            slug: "default",
          },
        },
      },
    });
    await createTenantOrganization(body);
    expect(sdk.tenantAdministrationCreateOrganization).toHaveBeenCalledWith({
      body: { name: "Beta", slug: "beta" },
      throwOnError: true,
    });
  });

  it("updates name/slug on the org path", async () => {
    sdk.tenantAdministrationUpdateOrganization.mockResolvedValue({
      data: { data: summary },
    });
    await updateTenantOrganization({
      orgId: "org_1",
      body: { name: "Acme Corp", slug: "acme-corp" },
    });
    expect(sdk.tenantAdministrationUpdateOrganization).toHaveBeenCalledWith({
      path: { orgId: "org_1" },
      body: { name: "Acme Corp", slug: "acme-corp" },
      throwOnError: true,
    });
  });

  it("suspends with confirmOrgId and reasonCode", async () => {
    sdk.tenantAdministrationSuspendOrganization.mockResolvedValue({
      data: {
        data: {
          ...summary,
          suspension: {
            suspended: true,
            reasonCode: "admin_ui_suspend",
          },
        },
      },
    });
    await suspendTenantOrganization({
      orgId: "org_1",
      reasonCode: "admin_ui_suspend",
    });
    expect(sdk.tenantAdministrationSuspendOrganization).toHaveBeenCalledWith({
      path: { orgId: "org_1" },
      body: { confirmOrgId: "org_1", reasonCode: "admin_ui_suspend" },
      throwOnError: true,
    });
  });

  it("reactivates with confirmOrgId", async () => {
    sdk.tenantAdministrationReactivateOrganization.mockResolvedValue({
      data: { data: summary },
    });
    await reactivateTenantOrganization("org_1");
    expect(sdk.tenantAdministrationReactivateOrganization).toHaveBeenCalledWith(
      {
        path: { orgId: "org_1" },
        body: { confirmOrgId: "org_1" },
        throwOnError: true,
      },
    );
  });
});

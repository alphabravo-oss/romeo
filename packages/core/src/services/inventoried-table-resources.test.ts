import type { AuthSubject } from "@romeo/auth";
import { describe, expect, it } from "vitest";

import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { registerDataExportPackage } from "./data-export-package-registry";
import {
  inventoriedTableResources,
} from "./inventoried-table-resources";
import { SessionService } from "./session-service";

const subject: AuthSubject = {
  groupIds: ["group_admins"],
  id: "user_dev_admin",
  isAdmin: true,
  orgId: "org_default",
  scopes: ["admin:read", "admin:write"],
  type: "user",
  workspaceIds: ["workspace_default"],
};

describe("inventoriedTableResources", () => {
  it("declares required keys for every registered resource", () => {
    const ids = Object.keys(inventoriedTableResources);
    expect(ids.length).toBeGreaterThan(10);
    for (const id of ids) {
      const resource = inventoriedTableResources[id]!;
      expect(resource.requiredRowKeys).toContain("id");
    }
  });

  it("loads impersonation requests, sessions, and export packages with their row keys", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createUser({
      email: "impersonation-target@example.com",
      id: "user_table_shape_target",
      name: "Shape Target",
      orgId: "org_default",
    });
    const sessions = new SessionService(repository);
    await repository.createUser({
      email: "shape-approver@example.com",
      id: "user_table_shape_approver",
      name: "Shape Approver",
      orgId: "org_default",
      role: "org_admin",
    });
    const request = await sessions.requestSupportSession({
      confirmTargetUserId: "user_table_shape_target",
      reason: "Table resource shape verification",
      subject,
      targetUserId: "user_table_shape_target",
      ticketRef: "SHAPE-1",
      ttlMinutes: 25,
    });
    const created = await sessions.approveSupportSessionRequest({
      requestId: request.id,
      subject: { ...subject, id: "user_table_shape_approver" },
    });
    await registerDataExportPackage({
      package: {
        artifact: {
          contentType: "application/json",
          downloadUrl:
            "/api/v1/governance/export-packages/export_pkg_aaaaaaaaaaaaaaaaaaaa/download",
          sha256: "a".repeat(64),
          sizeBytes: 12,
          storage: {
            driver: "object_store",
            objectKeyHash: "b".repeat(64),
            rawObjectKeyReturned: false,
          },
        },
        counts: {
          agents: 0,
          backgroundJobs: 0,
          chats: 0,
          chatComments: 0,
          dataConnectors: 0,
          dataConnectorSyncs: 0,
          fileObjectBytesIncluded: 0,
          fileObjects: 0,
          knowledgeBases: 0,
          knowledgeChunks: 0,
          knowledgeSourceBytesIncluded: 0,
          knowledgeSources: 0,
          messages: 0,
          messageParts: 0,
          promptTemplates: 0,
          usageEvents: 0,
          workflowRuns: 0,
          workflows: 0,
          workspaces: 0,
        },
        createdAt: "2026-08-14T00:00:00.000Z",
        exclusions: [],
        limits: { maxObjectBytes: 1, maxTotalObjectBytes: 1 },
        orgId: "org_default",
        packageId: "export_pkg_aaaaaaaaaaaaaaaaaaaa",
        request: {
          includeContent: false,
          includeObjectBytes: false,
          maxObjectBytes: 1,
          scope: "org",
        },
        schema: "romeo.data-export-package.v1",
        warnings: [],
      },
      repository,
    });

    const requests = await inventoriedTableResources.support_access_requests!.load({
      repository,
      subject,
    });
    const requestRow = requests.find((row) => row.id === request.id);
    expect(requestRow).toMatchObject({
      id: request.id,
      status: "approved",
      targetUserId: "user_table_shape_target",
      ttlMinutes: 25,
    });
    expect(requestRow).not.toHaveProperty("email");

    const sessionRows = await inventoriedTableResources.support_sessions!.load({
      repository,
      subject,
    });
    const sessionRow = sessionRows.find((row) => row.id === created.session.id);
    expect(sessionRow).toMatchObject({
      id: created.session.id,
      targetUserId: "user_table_shape_target",
    });
    expect(sessionRow?.session).toMatchObject({ id: created.session.id });

    const packages =
      await inventoriedTableResources.governance_export_packages!.load({
        repository,
        subject,
      });
    expect(packages[0]).toMatchObject({
      id: "export_pkg_aaaaaaaaaaaaaaaaaaaa",
      packageId: "export_pkg_aaaaaaaaaaaaaaaaaaaa",
    });
  });

  it("does not load users, grants, or providers for impersonation/export resources", () => {
    const source = inventoriedTableResources as Record<
      string,
      { load: { toString(): string } }
    >;
    expect(source.support_access_requests!.load.toString()).toContain(
      "supportRequestReports",
    );
    expect(source.support_access_requests!.load.toString()).not.toContain(
      "listUsers",
    );
    expect(source.support_sessions!.load.toString()).toContain(
      "toSupportSessionReport",
    );
    expect(source.governance_export_packages!.load.toString()).toContain(
      "listGovernedDataExportPackages",
    );
    expect(source.governance_export_packages!.load.toString()).not.toContain(
      "listResourceGrants",
    );
    expect(source.governance_access_grants!.load.toString()).toContain(
      "listResourceGrants",
    );
  });
});

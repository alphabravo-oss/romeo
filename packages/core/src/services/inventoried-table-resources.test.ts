import type { AuthSubject } from "@romeo/auth";
import { defaultProviderCapabilities } from "@romeo/providers";
import { describe, expect, it } from "vitest";

import { nativeInventoriedTableResources } from "../domain/inventoried-table-repository";
import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { registerDataExportPackage } from "./data-export-package-registry";
import { InventoriedTablePageService } from "./inventoried-table-page-service";
import { inventoriedTableResources } from "./inventoried-table-resources";
import { SessionService } from "./session-service";

const subject: AuthSubject = {
  groupIds: ["group_admins"],
  id: "user_dev_admin",
  isAdmin: true,
  orgId: "org_default",
  scopes: ["admin:read", "admin:write", "tools:use"],
  type: "user",
  workspaceIds: ["workspace_default"],
};

describe("inventoriedTableResources", () => {
  it("computes dashboard summaries from the full scoped resource", () => {
    expect(
      inventoriedTableResources.data_connectors?.summarize?.([
        { id: "connector-1", status: "active" },
        { id: "connector-2", status: "disabled" },
        { id: "connector-3", status: "active" },
      ]),
    ).toEqual({ activeTotal: 2, total: 3 });
    expect(
      inventoriedTableResources.tool_connectors?.summarize?.([
        { enabled: true, id: "tool-1" },
        { enabled: false, id: "tool-2" },
        { enabled: true, id: "tool-3" },
      ]),
    ).toEqual({ enabledTotal: 2, total: 3 });
    expect(
      inventoriedTableResources.notifications?.summarize?.([
        { id: "notification-1" },
        { id: "notification-2", readAt: null },
        { id: "notification-3", readAt: "2026-08-23T00:00:00Z" },
      ]),
    ).toEqual({ total: 3, unreadTotal: 2 });
    expect(
      inventoriedTableResources.prompt_templates?.summarize?.([
        { id: "prompt-1", visibility: "marketplace" },
        { id: "prompt-2", visibility: "private" },
        { id: "prompt-3", visibility: "marketplace" },
      ]),
    ).toEqual({ marketplaceTotal: 2, total: 3 });
  });

  it("declares required keys for every registered resource", () => {
    const ids = Object.keys(inventoriedTableResources);
    expect(ids.length).toBeGreaterThan(10);
    for (const id of ids) {
      const resource = inventoriedTableResources[id]!;
      expect(resource.requiredRowKeys).toContain("id");
    }
  });

  it("forbids load-all fallbacks for native server-paginated resources", () => {
    for (const id of nativeInventoriedTableResources) {
      expect(inventoriedTableResources[id]).toMatchObject({
        id,
        nativePagination: true,
      });
      expect(inventoriedTableResources[id]?.load).toBeUndefined();
    }
  });

  it("isolates provider, eval-suite, and tool-trace rows by required parent", async () => {
    const repository = new InMemoryRomeoRepository();
    for (const id of ["provider_scope_a", "provider_scope_b"]) {
      await repository.createProvider({
        baseUrl: "https://example.com/v1",
        capabilities: defaultProviderCapabilities("anthropic"),
        enabled: true,
        id,
        name: id,
        orgId: subject.orgId,
        type: "anthropic",
      });
    }
    await repository.upsertModels([
      scopedModel("model_scope_a", "provider_scope_a"),
      scopedModel("model_scope_b", "provider_scope_b"),
    ]);
    await repository.createEvalSuite({
      agentId: "agent_scope_a",
      createdAt: "2026-08-23T12:00:00.000Z",
      createdBy: subject.id,
      id: "suite_scope_a",
      name: "Scoped suite A",
      orgId: subject.orgId,
      updatedAt: "2026-08-23T12:00:00.000Z",
      workspaceId: "workspace_default",
    });
    await repository.createEvalSuite({
      agentId: "agent_scope_b",
      createdAt: "2026-08-23T12:00:00.000Z",
      createdBy: subject.id,
      id: "suite_scope_b",
      name: "Scoped suite B",
      orgId: subject.orgId,
      updatedAt: "2026-08-23T12:00:00.000Z",
      workspaceId: "workspace_default",
    });
    for (const agentId of ["agent_scope_a", "agent_scope_b"]) {
      await repository.createToolCall({
        actorId: subject.id,
        agentId,
        approvalRequired: false,
        completedAt: "2026-08-23T12:01:00.000Z",
        id: `call_${agentId}`,
        inputKeys: [],
        orgId: subject.orgId,
        outputKeys: [],
        riskLevel: "low",
        startedAt: "2026-08-23T12:00:00.000Z",
        status: "success",
        toolId: "tool_scope",
        workspaceId: "workspace_default",
      });
    }

    const loadIds = async (resourceId: string, parentId: string) => {
      const load = inventoriedTableResources[resourceId]?.load;
      if (load === undefined) throw new Error("expected bounded loader");
      return (await load({ parentId, repository, subject })).map(
        (row) => row.id,
      );
    };

    await expect(
      loadIds("provider_models", "provider_scope_a"),
    ).resolves.toEqual(["model_scope_a"]);
    await expect(loadIds("eval_suites", "agent_scope_a")).resolves.toEqual([
      "suite_scope_a",
    ]);
    const toolPage = await new InventoriedTablePageService(repository).query(
      subject,
      {
        filters: [],
        limit: 25,
        parentId: "agent_scope_a",
        resource: "tool_trace_calls",
        sort: [],
      },
    );
    expect(toolPage.items.map((row) => row.id)).toEqual(["call_agent_scope_a"]);
    await expect(
      loadIds("provider_models", "missing_provider"),
    ).resolves.toEqual([]);
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

    const tablePages = new InventoriedTablePageService(repository);
    const requests = (
      await tablePages.query(subject, {
        filters: [],
        limit: 25,
        resource: "support_access_requests",
        sort: [],
      })
    ).items;
    const requestRow = requests.find((row) => row.id === request.id);
    expect(requestRow).toMatchObject({
      id: request.id,
      status: "approved",
      targetUserId: "user_table_shape_target",
      ttlMinutes: 25,
    });
    expect(requestRow).not.toHaveProperty("email");

    const sessionRows = (
      await tablePages.query(subject, {
        filters: [],
        limit: 25,
        resource: "support_sessions",
        sort: [],
      })
    ).items;
    const sessionRow = sessionRows.find((row) => row.id === created.session.id);
    expect(sessionRow).toMatchObject({
      id: created.session.id,
      targetUserId: "user_table_shape_target",
    });
    expect(sessionRow?.session).toMatchObject({ id: created.session.id });

    const packages = (
      await tablePages.query(subject, {
        filters: [],
        limit: 25,
        resource: "governance_export_packages",
        sort: [],
      })
    ).items;
    expect(packages[0]).toMatchObject({
      id: "export_pkg_aaaaaaaaaaaaaaaaaaaa",
      packageId: "export_pkg_aaaaaaaaaaaaaaaaaaaa",
    });
  });

  it("keeps grants scoped to their authoritative repository", () => {
    const source = inventoriedTableResources as Record<
      string,
      { load?: { toString(): string } }
    >;
    expect(source.governance_access_grants?.load?.toString()).toContain(
      "listResourceGrants",
    );
  });
});

function scopedModel(id: string, providerId: string) {
  return {
    capabilities: defaultProviderCapabilities("anthropic"),
    contextWindow: 32_000,
    displayName: id,
    enabled: true,
    id,
    name: id,
    providerId,
  };
}

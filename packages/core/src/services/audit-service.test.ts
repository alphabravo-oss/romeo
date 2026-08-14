import { describe, expect, it } from "vitest";
import type { AuthSubject } from "@romeo/auth";

import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { AuditService } from "./audit-service";

const subject: AuthSubject = {
  id: "user_dev_admin",
  type: "user",
  orgId: "org_default",
  workspaceIds: ["workspace_default"],
  groupIds: [],
  scopes: ["audit:read"],
};

describe("AuditService", () => {
  it("hides successful background syncs unless noise is requested", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = new AuditService(repository);
    await repository.createAuditLog({
      id: "audit_sync",
      orgId: subject.orgId,
      actorId: "system_service_account_audit_test",
      action: "provider.models.sync",
      resourceType: "provider",
      resourceId: "provider_openai_compatible",
      outcome: "success",
      metadata: { modelCount: 3 },
      createdAt: "2026-08-12T18:00:00.000Z",
    });
    await repository.createAuditLog({
      id: "audit_sync_fail",
      orgId: subject.orgId,
      actorId: "system_service_account_audit_test",
      action: "provider.models.sync",
      resourceType: "provider",
      resourceId: "provider_openai_compatible",
      outcome: "failure",
      metadata: { error: "offline" },
      createdAt: "2026-08-12T18:01:00.000Z",
    });
    await repository.createAuditLog({
      id: "audit_chat",
      orgId: subject.orgId,
      actorId: "user_dev_admin",
      action: "chat.archive",
      resourceType: "chat",
      resourceId: "chat_1",
      outcome: "success",
      metadata: {},
      createdAt: "2026-08-12T18:02:00.000Z",
    });

    const defaultPage = await service.list(subject, { includeNoise: false });
    expect(defaultPage.map((log) => log.id)).toEqual([
      "audit_chat",
      "audit_sync_fail",
    ]);

    const withNoise = await service.list(subject, { includeNoise: true });
    expect(withNoise.map((log) => log.id)).toEqual([
      "audit_chat",
      "audit_sync_fail",
      "audit_sync",
    ]);

    const chats = await service.list(subject, { category: "chat" });
    expect(chats.map((log) => log.id)).toEqual(["audit_chat"]);

    const ranged = await service.list(subject, {
      includeNoise: false,
      from: "2026-08-12T18:01:30.000Z",
    });
    expect(ranged.map((log) => log.id)).toEqual(["audit_chat"]);

    const tablePage = await service.queryTable(subject, tableQuery(200));
    expect(tablePage.data.items.map((log) => log.id)).not.toContain(
      "audit_sync",
    );
    expect(tablePage.data.items.map((log) => log.id)).toContain(
      "audit_sync_fail",
    );
  });

  it("paginates with a stable createdAt and id keyset across inserts and deletes", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = new AuditService(repository);
    for (const [id, minute] of [
      ["audit_page_5", "05"],
      ["audit_page_4", "04"],
      ["audit_page_3", "03"],
      ["audit_page_2", "02"],
    ] as const)
      await createAudit(repository, id, `2026-08-14T12:${minute}:00.000Z`);

    const first = await service.queryTable(subject, tableQuery(2));
    expect(first.data.items.map((log) => log.id)).toEqual([
      "audit_page_5",
      "audit_page_4",
    ]);
    expect(first.data.page.nextCursor).not.toBeNull();

    await createAudit(
      repository,
      "audit_inserted_between_pages",
      "2026-08-14T12:06:00.000Z",
    );
    await repository.deleteAuditLogsBefore(
      subject.orgId,
      "2026-08-14T12:03:00.000Z",
    );
    const second = await service.queryTable(subject, {
      ...tableQuery(2),
      cursor: first.data.page.nextCursor!,
    });

    expect(second.data.items.map((log) => log.id)).toEqual(["audit_page_3"]);
    expect(second.data.page.nextCursor).toBeNull();
  });

  it("rejects tampered, cross-filter, and cross-tenant cursors", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = new AuditService(repository);
    await createAudit(repository, "audit_cursor_2", "2026-08-14T12:02:00.000Z");
    await createAudit(repository, "audit_cursor_1", "2026-08-14T12:01:00.000Z");
    const first = await service.queryTable(subject, tableQuery(1));
    const cursor = first.data.page.nextCursor!;
    const tampered = `${cursor.slice(0, -1)}${cursor.endsWith("a") ? "b" : "a"}`;

    await expect(
      service.queryTable(subject, { ...tableQuery(1), cursor: tampered }),
    ).rejects.toMatchObject({ code: "invalid_page_cursor", status: 400 });
    await expect(
      service.queryTable(subject, {
        ...tableQuery(1),
        cursor,
        filters: [{ field: "outcome", operator: "eq", value: "success" }],
      }),
    ).rejects.toMatchObject({ code: "invalid_page_cursor", status: 400 });
    await expect(
      service.queryTable(
        { ...subject, orgId: "org_other" },
        { ...tableQuery(1), cursor },
      ),
    ).rejects.toMatchObject({ code: "invalid_page_cursor", status: 400 });
  });

  it("applies allowlisted search and category filters without tenant leakage", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = new AuditService(repository);
    await createAudit(
      repository,
      "audit_search_match",
      "2026-08-14T12:02:00.000Z",
      { action: "local_auth.login", resourceId: "session_target" },
    );
    await repository.createAuditLog({
      id: "audit_foreign_sentinel",
      orgId: "org_other",
      actorId: "foreign_actor",
      action: "local_auth.login",
      resourceType: "session",
      resourceId: "session_target",
      outcome: "success",
      metadata: {},
      createdAt: "2026-08-14T12:03:00.000Z",
    });

    const page = await service.queryTable(subject, {
      ...tableQuery(10),
      search: "target",
      filters: [{ field: "category", operator: "eq", value: "security" }],
    });

    expect(page.data.items.map((log) => log.id)).toEqual([
      "audit_search_match",
    ]);
    expect(JSON.stringify(page)).not.toContain("foreign_sentinel");
  });

  it("rejects audit-table searches too short for indexed trigram lookup", async () => {
    const service = new AuditService(new InMemoryRomeoRepository());

    await expect(
      service.queryTable(subject, { ...tableQuery(10), search: "ab" }),
    ).rejects.toMatchObject({ code: "invalid_audit_table_query", status: 400 });
  });
});

function tableQuery(limit: number) {
  return {
    filters: [],
    limit,
    sort: [{ field: "createdAt", direction: "desc" as const }],
  };
}

async function createAudit(
  repository: InMemoryRomeoRepository,
  id: string,
  createdAt: string,
  overrides: { action?: string; resourceId?: string } = {},
) {
  await repository.createAuditLog({
    id,
    orgId: subject.orgId,
    actorId: subject.id,
    action: overrides.action ?? "admin.organization.update",
    resourceType: "session",
    resourceId: overrides.resourceId ?? id,
    outcome: "success",
    metadata: {},
    createdAt,
  });
}

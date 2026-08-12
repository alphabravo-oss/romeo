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
  });
});

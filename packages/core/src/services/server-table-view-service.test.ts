import type { AuthSubject } from "@romeo/auth";
import { describe, expect, it, vi } from "vitest";

import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { ServerTableViewService } from "./server-table-view-service";

const admin: AuthSubject = {
  groupIds: [],
  id: "user_dev_admin",
  isAdmin: true,
  orgId: "org_default",
  scopes: ["admin:read", "admin:write", "workspaces:read"],
  type: "user",
  workspaceIds: ["workspace_default"],
};

const member: AuthSubject = {
  groupIds: [],
  id: "user_saved_view_member",
  orgId: "org_default",
  scopes: ["workspaces:read"],
  type: "user",
  workspaceIds: ["workspace_default"],
};

describe("ServerTableViewService", () => {
  it("shares read-only views across users while preserving owner authority", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = new ServerTableViewService(repository);
    const created = await service.replace({
      subject: admin,
      workspaceId: "workspace_default",
      resource: "usage_events",
      view: { name: "Incidents" },
    });
    if ("outcome" in created) throw new Error("view was rejected");
    await service.share({
      subject: admin,
      workspaceId: "workspace_default",
      resource: "usage_events",
      viewId: created.id,
      visibility: "workspace",
    });

    const visible = await service.list({
      subject: member,
      workspaceId: "workspace_default",
      resource: "usage_events",
    });
    expect(visible).toMatchObject([
      { id: created.id, visibility: "workspace", ownerUserId: admin.id },
    ]);
    await expect(
      service.setDefault({
        subject: member,
        workspaceId: "workspace_default",
        resource: "usage_events",
        viewId: created.id,
        isDefault: true,
      }),
    ).rejects.toThrow("Saved view was not found.");
    await expect(
      service.remove({
        subject: member,
        workspaceId: "workspace_default",
        resource: "usage_events",
        viewId: created.id,
      }),
    ).resolves.toEqual({ deleted: false });
  });

  it("requires admin write authority before a view can be shared", async () => {
    const service = new ServerTableViewService(new InMemoryRomeoRepository());
    const created = await service.replace({
      subject: member,
      workspaceId: "workspace_default",
      resource: "usage_events",
      view: { name: "Mine" },
    });
    if ("outcome" in created) throw new Error("view was rejected");
    await expect(
      service.share({
        subject: member,
        workspaceId: "workspace_default",
        resource: "usage_events",
        viewId: created.id,
        visibility: "workspace",
      }),
    ).rejects.toThrow("Missing required scope: admin:write");
  });

  it("uses indexed saved-view persistence without scanning system settings", async () => {
    const repository = new InMemoryRomeoRepository();
    const settingsScan = vi
      .spyOn(repository, "listSystemSettings")
      .mockRejectedValue(new Error("system settings must not be scanned"));
    const service = new ServerTableViewService(repository);
    await service.replace({
      subject: admin,
      workspaceId: "workspace_default",
      resource: "usage_events",
      view: { name: "Durable" },
    });

    await expect(
      service.list({
        subject: admin,
        workspaceId: "workspace_default",
        resource: "usage_events",
      }),
    ).resolves.toMatchObject([{ name: "Durable", source: "server" }]);
    expect(settingsScan).not.toHaveBeenCalled();
  });

  it("enforces one default and rejects stale writes", async () => {
    const service = new ServerTableViewService(new InMemoryRomeoRepository());
    const first = await service.replace({
      subject: admin,
      workspaceId: "workspace_default",
      resource: "usage_events",
      view: { name: "First", isDefault: true },
    });
    const second = await service.replace({
      subject: admin,
      workspaceId: "workspace_default",
      resource: "usage_events",
      view: { name: "Second", isDefault: true },
    });
    if ("outcome" in first || "outcome" in second)
      throw new Error("view was rejected");

    expect(
      (
        await service.list({
          subject: admin,
          workspaceId: "workspace_default",
          resource: "usage_events",
        })
      ).filter((view) => view.isDefault),
    ).toMatchObject([{ id: second.id }]);
    await expect(
      service.setDefault({
        subject: admin,
        workspaceId: "workspace_default",
        resource: "usage_events",
        viewId: first.id,
        isDefault: true,
        expectedVersion: first.version,
      }),
    ).rejects.toThrow("changed or conflicts");
  });

  it("binds a one-time bounded undo token to owner, view, and version", async () => {
    const service = new ServerTableViewService(new InMemoryRomeoRepository());
    const created = await service.replace({
      subject: admin,
      workspaceId: "workspace_default",
      resource: "usage_events",
      view: { name: "Recoverable", isDefault: true },
    });
    if ("outcome" in created) throw new Error("view was rejected");
    const deleted = await service.remove({
      subject: admin,
      workspaceId: "workspace_default",
      resource: "usage_events",
      viewId: created.id,
      requestToken: "undo-token-one",
      now: "2026-08-23T12:00:00.000Z",
    });
    expect(deleted).toMatchObject({
      deleted: true,
      undoToken: "undo-token-one",
    });
    await expect(
      service.restore({
        subject: admin,
        workspaceId: "workspace_default",
        resource: "usage_events",
        viewId: created.id,
        undoToken: "stolen-token",
        now: "2026-08-23T12:00:01.000Z",
      }),
    ).rejects.toThrow("changed or conflicts");
    const restored = await service.restore({
      subject: admin,
      workspaceId: "workspace_default",
      resource: "usage_events",
      viewId: created.id,
      undoToken: "undo-token-one",
      now: "2026-08-23T12:00:02.000Z",
    });
    expect(restored).toMatchObject({ id: created.id, isDefault: true });
    expect(JSON.stringify(restored)).not.toContain("undo-token-one");
    await expect(
      service.restore({
        subject: admin,
        workspaceId: "workspace_default",
        resource: "usage_events",
        viewId: created.id,
        undoToken: "undo-token-one",
        now: "2026-08-23T12:00:03.000Z",
      }),
    ).rejects.toThrow("Saved view was not found");
  });

  it("rejects expired undo and missing parent-scoped authority", async () => {
    const service = new ServerTableViewService(new InMemoryRomeoRepository());
    const created = await service.replace({
      subject: admin,
      workspaceId: "workspace_default",
      resource: "usage_events",
      view: { name: "Expires" },
    });
    if ("outcome" in created) throw new Error("view was rejected");
    await service.remove({
      subject: admin,
      workspaceId: "workspace_default",
      resource: "usage_events",
      viewId: created.id,
      requestToken: "undo-token-expired",
      now: "2026-08-23T12:00:00.000Z",
    });
    await expect(
      service.restore({
        subject: admin,
        workspaceId: "workspace_default",
        resource: "usage_events",
        viewId: created.id,
        undoToken: "undo-token-expired",
        now: "2026-08-23T12:00:06.000Z",
      }),
    ).rejects.toThrow("changed or conflicts");
    await expect(
      service.list({
        subject: admin,
        workspaceId: "workspace_default",
        resource: "agent_versions",
      }),
    ).rejects.toThrow("resource or parent scope is invalid");
    await expect(
      service.list({
        subject: admin,
        workspaceId: "workspace_default",
        resource: "not_in_registry",
      }),
    ).rejects.toThrow("resource or parent scope is invalid");
  });
});

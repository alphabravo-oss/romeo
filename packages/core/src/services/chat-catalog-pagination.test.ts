import { describe, expect, it } from "vitest";

import type { AuthSubject } from "@romeo/auth";

import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { fixturePast } from "../test-support/fixture-clock";
import { ChatService } from "./chat-service";

const subject: AuthSubject = {
  id: "user_catalog_reader",
  type: "user",
  orgId: "org_default",
  workspaceIds: ["workspace_default"],
  groupIds: ["group_catalog_readers"],
  scopes: ["chats:read"],
};

describe("authorized chat catalog pagination", () => {
  it("applies ownership and group grants before totals and page limits", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = new ChatService(repository);
    const now = new Date().toISOString();
    await repository.createChat({
      id: "chat_catalog_owned",
      orgId: "org_default",
      workspaceId: "workspace_default",
      title: "Owned",
      createdBy: subject.id,
      updatedAt: "2026-07-16T12:03:00.000Z",
    });
    await repository.createChat({
      id: "chat_catalog_group",
      orgId: "org_default",
      workspaceId: "workspace_default",
      title: "Group shared",
      createdBy: "another_user",
      updatedAt: "2026-07-16T12:02:00.000Z",
    });
    await repository.createChat({
      id: "chat_catalog_hidden",
      orgId: "org_default",
      workspaceId: "workspace_default",
      title: "Hidden",
      createdBy: "another_user",
      updatedAt: "2026-07-16T12:01:00.000Z",
    });
    await repository.createChat({
      id: "chat_catalog_expired",
      orgId: "org_default",
      workspaceId: "workspace_default",
      title: "Expired",
      createdBy: subject.id,
      temporary: true,
      expiresAt: fixturePast(),
      updatedAt: now,
    });
    await repository.createResourceGrant({
      id: "grant_catalog_group",
      resourceType: "chat",
      resourceId: "chat_catalog_group",
      principalType: "group",
      principalId: "group_catalog_readers",
      permission: "read",
    });

    const first = await service.listPage("workspace_default", subject, {
      limit: 1,
      offset: 0,
    });
    const second = await service.listPage("workspace_default", subject, {
      limit: 1,
      offset: 1,
    });

    expect(first).toMatchObject({ total: 2, limit: 1, offset: 0 });
    expect(first.items.map((chat) => chat.id)).toEqual(["chat_catalog_owned"]);
    expect(second).toMatchObject({ total: 2, limit: 1, offset: 1 });
    expect(second.items.map((chat) => chat.id)).toEqual(["chat_catalog_group"]);
  });
});

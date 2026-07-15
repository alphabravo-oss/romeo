import { describe, expect, it } from "vitest";

import {
  toPromptTemplateRecord,
  toResourceFavoriteRecord,
  toWorkspaceFolderItemRecord,
} from "./collaboration-repository";

describe("collaboration repository mappers", () => {
  it("maps prompt template visibility and optional descriptions", () => {
    const template = toPromptTemplateRecord({
      id: "prompt_1",
      orgId: "org_1",
      workspaceId: "workspace_1",
      name: "Review",
      description: null,
      body: "Review this.",
      tags: ["review", "legal"],
      visibility: "unknown",
      createdBy: "user_1",
      createdAt: new Date("2026-06-27T00:00:00.000Z"),
      updatedAt: new Date("2026-06-27T00:01:00.000Z"),
    });

    expect(template.visibility).toBe("private");
    expect(template.description).toBeUndefined();
    expect(template.tags).toEqual(["review", "legal"]);
  });

  it("maps favorites and folder items with safe resource-type fallbacks", () => {
    const favorite = toResourceFavoriteRecord({
      id: "favorite_1",
      orgId: "org_1",
      userId: "user_1",
      resourceType: "unknown",
      resourceId: "agent_1",
      createdAt: new Date("2026-06-27T00:00:00.000Z"),
    });
    const item = toWorkspaceFolderItemRecord({
      id: "item_1",
      orgId: "org_1",
      workspaceId: "workspace_1",
      folderId: "folder_1",
      resourceType: "unknown",
      resourceId: "chat_1",
      createdAt: new Date("2026-06-27T00:00:00.000Z"),
    });

    expect(favorite.resourceType).toBe("agent");
    expect(item.resourceType).toBe("agent");
  });
});

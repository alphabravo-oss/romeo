import { describe, expect, it } from "vitest";

import { ListFolderItemsBatchSchema } from "./collaboration-folder-routes";

describe("folder item batch contract", () => {
  it("applies defaults and rejects oversized or duplicate folder batches", () => {
    const parsed = ListFolderItemsBatchSchema.parse({
      workspaceId: "workspace_default",
      folderIds: ["folder_a", "folder_b"],
    });
    expect(parsed.limitPerFolder).toBe(100);
    expect(
      ListFolderItemsBatchSchema.safeParse({
        workspaceId: "workspace_default",
        folderIds: ["folder_a", "folder_a"],
      }).success,
    ).toBe(false);
    expect(
      ListFolderItemsBatchSchema.safeParse({
        workspaceId: "workspace_default",
        folderIds: Array.from({ length: 51 }, (_, index) => `folder_${index}`),
      }).success,
    ).toBe(false);
    expect(
      ListFolderItemsBatchSchema.safeParse({
        workspaceId: "workspace_default",
        folderIds: ["folder_a"],
        limitPerFolder: 201,
      }).success,
    ).toBe(false);
  });
});

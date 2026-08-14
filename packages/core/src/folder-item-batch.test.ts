import { describe, expect, it } from "vitest";

import { createRomeoApi } from "./api";
import type {
  AuthorizedWorkspaceFolderItemsBatchInput,
  WorkspaceFolderItemsBatchGroup,
} from "./domain/entities";
import { InMemoryRomeoRepository } from "./repositories/in-memory";

class TrackingFolderRepository extends InMemoryRomeoRepository {
  authorizedFolderCalls = 0;
  batchCalls = 0;
  resourceGrantListCalls = 0;
  singleFolderCalls = 0;
  workspaceFolderListCalls = 0;

  override async listAuthorizedWorkspaceFoldersByIds(
    input: Parameters<
      InMemoryRomeoRepository["listAuthorizedWorkspaceFoldersByIds"]
    >[0],
  ) {
    this.authorizedFolderCalls += 1;
    return super.listAuthorizedWorkspaceFoldersByIds(input);
  }

  override async listResourceGrants(orgId: string) {
    this.resourceGrantListCalls += 1;
    return super.listResourceGrants(orgId);
  }

  override async listWorkspaceFolders(orgId: string, workspaceId?: string) {
    this.workspaceFolderListCalls += 1;
    return super.listWorkspaceFolders(orgId, workspaceId);
  }

  override async listWorkspaceFolderItems(folderId: string) {
    this.singleFolderCalls += 1;
    return super.listWorkspaceFolderItems(folderId);
  }

  override async listAuthorizedWorkspaceFolderItemsBatch(
    input: AuthorizedWorkspaceFolderItemsBatchInput,
  ): Promise<WorkspaceFolderItemsBatchGroup[]> {
    this.batchCalls += 1;
    return super.listAuthorizedWorkspaceFolderItemsBatch(input);
  }
}

describe("folder item batch API", () => {
  it("loads multiple folders once with stable per-folder bounds", async () => {
    const repository = new TrackingFolderRepository();
    const api = createRomeoApi(repository);
    for (const [id, name] of [
      ["folder_batch_a", "Batch A"],
      ["folder_batch_b", "Batch B"],
    ] as const) {
      await repository.createWorkspaceFolder({
        id,
        orgId: "org_default",
        workspaceId: "workspace_default",
        name,
        createdBy: "user_dev_admin",
        createdAt: "2026-08-14T12:00:00.000Z",
        updatedAt: "2026-08-14T12:00:00.000Z",
      });
    }
    await repository.createWorkspaceFolderItem({
      id: "folder_item_batch_agent",
      orgId: "org_default",
      workspaceId: "workspace_default",
      folderId: "folder_batch_a",
      resourceType: "agent",
      resourceId: "agent_default",
      createdAt: "2026-08-14T12:01:00.000Z",
    });
    await repository.createWorkspaceFolderItem({
      id: "folder_item_batch_chat_a",
      orgId: "org_default",
      workspaceId: "workspace_default",
      folderId: "folder_batch_a",
      resourceType: "chat",
      resourceId: "chat_welcome",
      createdAt: "2026-08-14T12:02:00.000Z",
    });
    await repository.createWorkspaceFolderItem({
      id: "folder_item_batch_chat_b",
      orgId: "org_default",
      workspaceId: "workspace_default",
      folderId: "folder_batch_b",
      resourceType: "chat",
      resourceId: "chat_welcome",
      createdAt: "2026-08-14T12:03:00.000Z",
    });

    const response = await api.request(
      "/api/v1/collaboration/folder-items/batch",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: "workspace_default",
          folderIds: ["folder_batch_b", "folder_batch_a"],
          limitPerFolder: 1,
        }),
      },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual([
      {
        folderId: "folder_batch_a",
        hasMore: true,
        items: [expect.objectContaining({ id: "folder_item_batch_agent" })],
      },
      {
        folderId: "folder_batch_b",
        hasMore: false,
        items: [expect.objectContaining({ id: "folder_item_batch_chat_b" })],
      },
    ]);
    expect(repository.batchCalls).toBe(1);
    expect(repository.authorizedFolderCalls).toBe(1);
    expect(repository.resourceGrantListCalls).toBe(0);
    expect(repository.singleFolderCalls).toBe(0);
    expect(repository.workspaceFolderListCalls).toBe(0);
  });

  it("rejects cross-tenant folders without returning foreign sentinels", async () => {
    const repository = new TrackingFolderRepository();
    const api = createRomeoApi(repository);
    await repository.createWorkspaceFolder({
      id: "foreign_folder_sentinel",
      orgId: "org_foreign",
      workspaceId: "workspace_foreign",
      name: "Foreign private folder",
      createdBy: "foreign_user",
      createdAt: "2026-08-14T12:00:00.000Z",
      updatedAt: "2026-08-14T12:00:00.000Z",
    });

    const response = await api.request(
      "/api/v1/collaboration/folder-items/batch",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: "workspace_default",
          folderIds: ["foreign_folder_sentinel"],
        }),
      },
    );
    const body = await response.text();

    expect(response.status).toBe(404);
    expect(body).not.toContain("foreign_folder_sentinel");
    expect(body).not.toContain("Foreign private folder");
    expect(repository.batchCalls).toBe(0);
  });
});

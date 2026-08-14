import type { WorkspaceFolder } from "./types";

import { MutationObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as appQueryKeys from "../../lib/app-query-keys";
import { completeMutationNetworkRevalidation } from "../../lib/connectivity";
import { advanceMutationSessionBoundary } from "../../lib/mutation-session-boundary";
import { createRomeoQueryClient } from "../../lib/query-client";
import { collaborationListFolderItemsBatchQueryKey } from "./folder-item-batch-query";
import {
  addFolderItemMutationOptions,
  shareChatAccessMutationOptions,
  updateFolderMutationOptions,
} from "./mutation-options";

const mutationMocks = vi.hoisted(() => ({
  addFolderItem: vi.fn(),
  assignChatTag: vi.fn(),
  createFolder: vi.fn(),
  revokeChatShare: vi.fn(),
  shareChat: vi.fn(),
  shareChatAccess: vi.fn(),
  updateFolder: vi.fn(),
}));

vi.mock("./mutations", () => mutationMocks);

const folder = (name: string): WorkspaceFolder => ({
  createdAt: "2026-08-14T00:00:00.000Z",
  createdBy: "user-1",
  id: "folder-1",
  name,
  orgId: "org-1",
  updatedAt: "2026-08-14T00:00:00.000Z",
  workspaceId: "workspace-1",
});

describe("collaboration mutation policies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completeMutationNetworkRevalidation();
    advanceMutationSessionBoundary();
  });

  it("rolls a folder rename back after authorization failure", async () => {
    const client = createRomeoQueryClient();
    const key = appQueryKeys.folders("workspace-1");
    client.setQueryData(key, [folder("Before")]);
    let rejectUpdate!: (error: Error) => void;
    mutationMocks.updateFolder.mockReturnValueOnce(
      new Promise<WorkspaceFolder>((_resolve, reject) => {
        rejectUpdate = reject;
      }),
    );
    const observer = new MutationObserver(
      client,
      updateFolderMutationOptions(),
    );
    const mutation = observer.mutate({
      folderId: "folder-1",
      name: "Optimistic",
      workspaceId: "workspace-1",
    });
    await vi.waitFor(() =>
      expect(client.getQueryData<WorkspaceFolder[]>(key)?.[0]?.name).toBe(
        "Optimistic",
      ),
    );

    rejectUpdate(new Error("unauthorized"));
    await expect(mutation).rejects.toThrow("unauthorized");
    expect(client.getQueryData(key)).toEqual([folder("Before")]);
  });

  it("invalidates only the changed folder and its exact batch", async () => {
    const client = createRomeoQueryClient();
    const folderIds = ["folder-1", "folder-2"];
    const batchKey = collaborationListFolderItemsBatchQueryKey(
      "workspace-1",
      folderIds,
    );
    const otherBatchKey = collaborationListFolderItemsBatchQueryKey(
      "workspace-2",
      ["folder-3"],
    );
    client.setQueryData(appQueryKeys.folderItems("folder-1"), []);
    client.setQueryData(appQueryKeys.folderItems("folder-2"), []);
    client.setQueryData(batchKey, []);
    client.setQueryData(otherBatchKey, []);
    mutationMocks.addFolderItem.mockResolvedValueOnce({ id: "item-1" });
    const observer = new MutationObserver(
      client,
      addFolderItemMutationOptions(),
    );

    await observer.mutate({
      folderId: "folder-1",
      folderIds,
      resourceId: "chat-1",
      resourceType: "chat",
      workspaceId: "workspace-1",
    });

    expect(
      client.getQueryState(appQueryKeys.folderItems("folder-1"))?.isInvalidated,
    ).toBe(true);
    expect(
      client.getQueryState(appQueryKeys.folderItems("folder-2"))?.isInvalidated,
    ).toBe(false);
    expect(client.getQueryState(batchKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherBatchKey)?.isInvalidated).toBe(false);
  });

  it("refreshes every concrete share view for only the changed chat", async () => {
    const client = createRomeoQueryClient();
    const defaultKey = appQueryKeys.chatShares("chat-1");
    const accessKey = appQueryKeys.chatShares("chat-1", "access");
    const otherKey = appQueryKeys.chatShares("chat-2", "access");
    const filteredAuditKey = appQueryKeys.auditLogs({
      filters: [{ field: "category", operator: "eq", value: "access" }],
      limit: 50,
      sort: [{ direction: "desc", field: "createdAt" }],
    });
    client.setQueryData(defaultKey, []);
    client.setQueryData(accessKey, []);
    client.setQueryData(otherKey, []);
    client.setQueryData(filteredAuditKey, []);
    mutationMocks.shareChatAccess.mockResolvedValueOnce([]);
    const observer = new MutationObserver(
      client,
      shareChatAccessMutationOptions(),
    );

    await observer.mutate({
      chatId: "chat-1",
      permissions: ["read"],
      principalId: "group-1",
      principalType: "group",
    });

    expect(client.getQueryState(defaultKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(accessKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherKey)?.isInvalidated).toBe(false);
    expect(client.getQueryState(filteredAuditKey)?.isInvalidated).toBe(true);
  });
});

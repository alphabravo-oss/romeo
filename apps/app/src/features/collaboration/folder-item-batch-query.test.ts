import { readFile } from "node:fs/promises";

import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  chunkFolderIds,
  collaborationListFolderItemsBatchOptions,
  FOLDER_ITEM_BATCH_CONCURRENCY,
  folderItemGroupsById,
  invalidateFolderItemQueries,
  loadFolderItemBatchChunks,
  shouldLoadFolderItemsOverflow,
} from "./folder-item-batch-query";
import { listFolderItemsBatch } from "./queries";

vi.mock("./queries", () => ({ listFolderItemsBatch: vi.fn() }));

const mockedBatch = vi.mocked(listFolderItemsBatch);

beforeEach(() => {
  mockedBatch.mockReset();
});

describe("folder item batch query", () => {
  it("keeps WorkspaceNav free of per-folder useQueries fan-out", async () => {
    const source = await readFile(
      new URL("../../components/WorkspaceNav.tsx", import.meta.url),
      "utf8",
    );
    expect(source).not.toContain("useQueries");
    expect(source).toContain("collaborationListFolderItemsBatchOptions");
  });

  it("uses one request for up to 50 folders and maps groups by folder id", async () => {
    const folderIds = Array.from(
      { length: 50 },
      (_, index) => `folder-${index}`,
    );
    mockedBatch.mockResolvedValue([
      { folderId: "folder-49", hasMore: false, items: [] },
      { folderId: "folder-0", hasMore: true, items: [] },
    ]);
    const queryClient = new QueryClient();

    const groups = await queryClient.fetchQuery(
      collaborationListFolderItemsBatchOptions("workspace-1", folderIds),
    );
    const byId = folderItemGroupsById(groups);

    expect(mockedBatch).toHaveBeenCalledTimes(1);
    expect(mockedBatch.mock.calls[0]?.[0].folderIds).toHaveLength(50);
    expect(byId.get("folder-49")?.folderId).toBe("folder-49");
    expect(
      shouldLoadFolderItemsOverflow("folder-0", byId.get("folder-0")),
    ).toBe(true);
    expect(
      shouldLoadFolderItemsOverflow("folder-49", byId.get("folder-49")),
    ).toBe(false);
  });

  it("bounds larger collections into parallel groups of at most 50", () => {
    expect(
      chunkFolderIds(Array.from({ length: 101 }, (_, index) => `${index}`)),
    ).toEqual([expect.any(Array), expect.any(Array), expect.any(Array)]);
    expect(
      chunkFolderIds(Array.from({ length: 101 }, (_, index) => `${index}`)).map(
        (chunk) => chunk.length,
      ),
    ).toEqual([50, 50, 1]);
  });

  it("never exceeds the fixed request concurrency and preserves chunk order", async () => {
    let active = 0;
    let maxActive = 0;
    let requestIndex = 0;
    mockedBatch.mockImplementation(async () => {
      const currentIndex = requestIndex;
      requestIndex += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 0));
      active -= 1;
      return [
        {
          folderId: `folder-${String(currentIndex * 50).padStart(3, "0")}`,
          hasMore: false,
          items: [],
        },
      ];
    });
    const folderIds = Array.from(
      { length: 201 },
      (_, index) => `folder-${String(index).padStart(3, "0")}`,
    );
    const queryClient = new QueryClient();

    const groups = await queryClient.fetchQuery(
      collaborationListFolderItemsBatchOptions("workspace-1", folderIds),
    );

    expect(mockedBatch).toHaveBeenCalledTimes(5);
    expect(maxActive).toBe(FOLDER_ITEM_BATCH_CONCURRENCY);
    expect(groups.map((group) => group.folderId)).toEqual([
      "folder-000",
      "folder-050",
      "folder-100",
      "folder-150",
      "folder-200",
    ]);
  });

  it("invalidates only the changed folder and its exact batch", async () => {
    const queryClient = new QueryClient();
    const batch = collaborationListFolderItemsBatchOptions("workspace-1", [
      "folder-1",
      "folder-2",
    ]);
    const otherBatch = collaborationListFolderItemsBatchOptions("workspace-2", [
      "folder-3",
    ]);
    queryClient.setQueryData(batch.queryKey, []);
    queryClient.setQueryData(otherBatch.queryKey, []);
    queryClient.setQueryData(["folderItems", "folder-1"], []);
    queryClient.setQueryData(["folderItems", "folder-2"], []);

    await invalidateFolderItemQueries(queryClient, {
      folderId: "folder-1",
      folderIds: ["folder-2", "folder-1"],
      workspaceId: "workspace-1",
    });

    expect(queryClient.getQueryState(batch.queryKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(otherBatch.queryKey)?.isInvalidated).toBe(
      false,
    );
    expect(
      queryClient.getQueryState(["folderItems", "folder-1"])?.isInvalidated,
    ).toBe(true);
    expect(
      queryClient.getQueryState(["folderItems", "folder-2"])?.isInvalidated,
    ).toBe(false);
  });

  it("forwards cancellation to the in-flight batch", async () => {
    let observedSignal: AbortSignal | undefined;
    mockedBatch.mockImplementation((_input, signal) => {
      observedSignal = signal;
      return Promise.resolve([]);
    });
    const options = collaborationListFolderItemsBatchOptions("workspace-1", [
      "folder-1",
    ]);
    const controller = new AbortController();
    if (typeof options.queryFn !== "function")
      throw new Error("Missing queryFn");
    await options.queryFn({
      client: new QueryClient(),
      meta: undefined,
      queryKey: options.queryKey,
      signal: controller.signal,
    });
    controller.abort();
    expect(observedSignal).toBe(controller.signal);
    expect(observedSignal?.aborted).toBe(true);
    expect(mockedBatch).toHaveBeenCalledTimes(1);
  });

  it("does not schedule chunks for an already cancelled query", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      loadFolderItemBatchChunks(
        "workspace-1",
        Array.from({ length: 201 }, (_, index) => `folder-${index}`),
        controller.signal,
      ),
    ).rejects.toBeDefined();
    expect(mockedBatch).not.toHaveBeenCalled();
  });

  it("does not schedule queued chunks after in-flight requests are cancelled", async () => {
    mockedBatch.mockImplementation(
      (_input, signal) =>
        new Promise((_resolve, reject) => {
          const rejectAbort = () =>
            reject(
              signal?.reason instanceof Error
                ? signal.reason
                : new DOMException("Aborted", "AbortError"),
            );
          if (signal?.aborted === true) {
            rejectAbort();
            return;
          }
          signal?.addEventListener("abort", rejectAbort, { once: true });
        }),
    );
    const controller = new AbortController();
    const pending = loadFolderItemBatchChunks(
      "workspace-1",
      Array.from({ length: 201 }, (_, index) => `folder-${index}`),
      controller.signal,
    );

    expect(mockedBatch).toHaveBeenCalledTimes(FOLDER_ITEM_BATCH_CONCURRENCY);
    controller.abort();

    await expect(pending).rejects.toBeDefined();
    expect(mockedBatch).toHaveBeenCalledTimes(FOLDER_ITEM_BATCH_CONCURRENCY);
  });
});

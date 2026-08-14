import { MutationObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  completeMutationNetworkRevalidation,
  markMutationNetworkOffline,
} from "../../lib/connectivity";
import { advanceMutationSessionBoundary } from "../../lib/mutation-session-boundary";
import { createRomeoQueryClient } from "../../lib/query-client";
import * as appQueryKeys from "../../lib/app-query-keys";
import type { KnowledgeSource } from "./types";
import {
  deleteKnowledgeSourceMutationOptions,
  queryTieredKnowledgeMutationOptions,
} from "./mutation-options";

const mutationMocks = vi.hoisted(() => ({
  compareTieredKnowledgeReplay: vi.fn(),
  createKnowledgeBase: vi.fn(),
  createKnowledgeSource: vi.fn(),
  deleteKnowledgeSource: vi.fn(),
  extractKnowledgeSource: vi.fn(),
  queryKnowledgeBase: vi.fn(),
  queryTieredKnowledge: vi.fn(),
  reindexKnowledgeSource: vi.fn(),
  replayTieredKnowledge: vi.fn(),
}));

vi.mock("./mutations", () => mutationMocks);

describe("knowledge computation mutation policies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completeMutationNetworkRevalidation();
    advanceMutationSessionBoundary();
  });

  it("fails closed offline without invoking retrieval", async () => {
    const client = createRomeoQueryClient();
    const observer = new MutationObserver(
      client,
      queryTieredKnowledgeMutationOptions(),
    );
    markMutationNetworkOffline();

    await expect(
      observer.mutate({ knowledgeBaseIds: ["kb-1"], query: "policy" }),
    ).rejects.toMatchObject({ code: "mutation_network_blocked" });
    expect(mutationMocks.queryTieredKnowledge).not.toHaveBeenCalled();
  });

  it("rolls a deleted source back after authorization failure", async () => {
    const client = createRomeoQueryClient();
    const source = {
      id: "source-1",
      knowledgeBaseId: "kb-1",
    } as KnowledgeSource;
    const key = appQueryKeys.knowledgeSources("kb-1");
    client.setQueryData(key, [source]);
    let rejectDelete!: (error: Error) => void;
    mutationMocks.deleteKnowledgeSource.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectDelete = reject;
      }),
    );
    const observer = new MutationObserver(
      client,
      deleteKnowledgeSourceMutationOptions(),
    );
    const pending = observer.mutate({
      knowledgeBaseId: "kb-1",
      sourceId: "source-1",
      workspaceId: "workspace-1",
    });
    await vi.waitFor(() => expect(client.getQueryData(key)).toEqual([]));

    rejectDelete(new Error("forbidden"));
    await expect(pending).rejects.toThrow("forbidden");
    expect(client.getQueryData(key)).toEqual([source]);
  });
});

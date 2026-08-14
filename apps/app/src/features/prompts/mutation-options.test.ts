import { MutationObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as appQueryKeys from "../../lib/app-query-keys";
import { completeMutationNetworkRevalidation } from "../../lib/connectivity";
import { advanceMutationSessionBoundary } from "../../lib/mutation-session-boundary";
import { createRomeoQueryClient } from "../../lib/query-client";
import { clearRouteDataForLogout } from "../../lib/route-intent";
import type { PromptTemplate } from "./types";
import {
  createPromptTemplateMutationOptions,
  updatePromptTemplateMutationOptions,
} from "./mutation-options";

const mutationMocks = vi.hoisted(() => ({
  createPromptTemplate: vi.fn(),
  deletePromptTemplate: vi.fn(),
  updatePromptTemplate: vi.fn(),
}));

vi.mock("./mutations", () => mutationMocks);

const template = (name: string): PromptTemplate => ({
  body: "Hello",
  createdAt: "2026-08-14T00:00:00.000Z",
  createdBy: "user-1",
  id: "prompt-1",
  name,
  orgId: "org-1",
  tags: [],
  updatedAt: "2026-08-14T00:00:00.000Z",
  visibility: "workspace",
  workspaceId: "workspace-1",
});

describe("prompt template mutation policies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completeMutationNetworkRevalidation();
    advanceMutationSessionBoundary();
  });

  it("exactly invalidates every cached workspace and marketplace view", async () => {
    const client = createRomeoQueryClient();
    const listKey = appQueryKeys.promptTemplates("workspace-1");
    const pageKey = appQueryKeys.promptTemplates("workspace-1", {
      page: 1,
      query: "hello",
    });
    const otherWorkspaceKey = appQueryKeys.promptTemplates("workspace-2");
    const marketplaceKey = appQueryKeys.promptMarketplace("workspace-1");
    const otherMarketplaceKey = appQueryKeys.promptMarketplace("workspace-2");
    for (const key of [
      listKey,
      pageKey,
      otherWorkspaceKey,
      marketplaceKey,
      otherMarketplaceKey,
    ]) {
      client.setQueryData(key, []);
    }
    mutationMocks.createPromptTemplate.mockResolvedValueOnce(template("New"));
    const observer = new MutationObserver(
      client,
      createPromptTemplateMutationOptions(),
    );

    await observer.mutate({
      body: "Hello",
      name: "New",
      workspaceId: "workspace-1",
    });

    expect(client.getQueryState(listKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(pageKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherWorkspaceKey)?.isInvalidated).toBe(false);
    expect(client.getQueryState(marketplaceKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherMarketplaceKey)?.isInvalidated).toBe(true);
  });

  it("leaves prompt views untouched after a conflict", async () => {
    const client = createRomeoQueryClient();
    const key = appQueryKeys.promptTemplates("workspace-1");
    client.setQueryData(key, [template("Before")]);
    mutationMocks.createPromptTemplate.mockRejectedValueOnce(
      new Error("conflict"),
    );
    const observer = new MutationObserver(
      client,
      createPromptTemplateMutationOptions(),
    );

    await expect(
      observer.mutate({
        body: "Hello",
        name: "After",
        workspaceId: "workspace-1",
      }),
    ).rejects.toThrow("conflict");
    expect(client.getQueryData(key)).toEqual([template("Before")]);
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  });

  it("does not refresh prompt data when an update completes after logout", async () => {
    const client = createRomeoQueryClient();
    let resolveUpdate!: (value: PromptTemplate) => void;
    mutationMocks.updatePromptTemplate.mockReturnValueOnce(
      new Promise<PromptTemplate>((resolve) => {
        resolveUpdate = resolve;
      }),
    );
    const observer = new MutationObserver(
      client,
      updatePromptTemplateMutationOptions(),
    );
    const pending = observer.mutate({
      promptTemplateId: "prompt-1",
      update: { name: "After" },
      workspaceId: "workspace-1",
    });
    await vi.waitFor(() =>
      expect(mutationMocks.updatePromptTemplate).toHaveBeenCalled(),
    );

    await clearRouteDataForLogout(client);
    const key = appQueryKeys.promptTemplates("workspace-1");
    client.setQueryData(key, [template("Next session")]);
    resolveUpdate(template("After"));
    await pending;

    expect(client.getQueryData(key)).toEqual([template("Next session")]);
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  });
});

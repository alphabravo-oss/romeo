import { MutationObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as appQueryKeys from "../../lib/app-query-keys";
import {
  completeMutationNetworkRevalidation,
  markMutationNetworkOffline,
} from "../../lib/connectivity";
import { advanceMutationSessionBoundary } from "../../lib/mutation-session-boundary";
import { createRomeoQueryClient } from "../../lib/query-client";
import { clearRouteDataForLogout } from "../../lib/route-intent";
import type { Group, GroupMember } from "./types";
import {
  addGroupMemberMutationOptions,
  createGroupMutationOptions,
  removeGroupMemberMutationOptions,
} from "./group-mutation-options";

const mutationMocks = vi.hoisted(() => ({
  addGroupMember: vi.fn(),
  createGroup: vi.fn(),
  removeGroupMember: vi.fn(),
}));

vi.mock("./mutations", () => mutationMocks);

const group = (id = "group-1"): Group => ({
  createdAt: "2026-08-14T00:00:00.000Z",
  id,
  name: "Security",
  orgId: "org-1",
  slug: "security",
});

const member = (userId = "user-1"): GroupMember => ({
  createdAt: "2026-08-14T00:00:00.000Z",
  groupId: "group-1",
  orgId: "org-1",
  userId,
});

describe("group administration mutation policies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completeMutationNetworkRevalidation();
    advanceMutationSessionBoundary();
  });

  it("reconciles group creation into the exact catalog", async () => {
    const client = createRomeoQueryClient();
    const queryKey = appQueryKeys.groups();
    const created = group();
    client.setQueryData(queryKey, []);
    mutationMocks.createGroup.mockResolvedValueOnce(created);
    const observer = new MutationObserver(client, createGroupMutationOptions());

    await observer.mutate({ name: created.name, slug: created.slug });

    expect(client.getQueryData(queryKey)).toEqual([created]);
    expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
  });

  it("adds a member without invalidating another group", async () => {
    const client = createRomeoQueryClient();
    const selectedKey = appQueryKeys.groups("group-1", "members");
    const otherKey = appQueryKeys.groups("group-2", "members");
    const added = member();
    client.setQueryData(selectedKey, []);
    client.setQueryData(otherKey, []);
    mutationMocks.addGroupMember.mockResolvedValueOnce(added);
    const observer = new MutationObserver(
      client,
      addGroupMemberMutationOptions(),
    );

    await observer.mutate({ groupId: added.groupId, userId: added.userId });

    expect(client.getQueryData(selectedKey)).toEqual([added]);
    expect(client.getQueryState(selectedKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherKey)?.isInvalidated).toBe(false);
  });

  it("removes a member optimistically and converges exactly", async () => {
    const client = createRomeoQueryClient();
    const queryKey = appQueryKeys.groups("group-1", "members");
    const removed = member();
    client.setQueryData(queryKey, [removed, member("user-2")]);
    mutationMocks.removeGroupMember.mockResolvedValueOnce(removed);
    const observer = new MutationObserver(
      client,
      removeGroupMemberMutationOptions(),
    );

    await observer.mutate({
      groupId: removed.groupId,
      userId: removed.userId,
    });

    expect(client.getQueryData(queryKey)).toEqual([member("user-2")]);
    expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
  });

  it("rolls membership removal back after conflict or authorization failure", async () => {
    const client = createRomeoQueryClient();
    const queryKey = appQueryKeys.groups("group-1", "members");
    const existing = member();
    const observer = new MutationObserver(
      client,
      removeGroupMemberMutationOptions(),
    );

    for (const error of ["version_conflict", "forbidden"]) {
      client.setQueryData(queryKey, [existing]);
      mutationMocks.removeGroupMember.mockRejectedValueOnce(new Error(error));
      await expect(
        observer.mutate({
          groupId: existing.groupId,
          userId: existing.userId,
        }),
      ).rejects.toThrow(error);
      expect(client.getQueryData(queryKey)).toEqual([existing]);
      expect(client.getQueryState(queryKey)?.isInvalidated).toBe(false);
    }
  });

  it("executes no membership write while offline", async () => {
    const client = createRomeoQueryClient();
    markMutationNetworkOffline();
    const observer = new MutationObserver(
      client,
      addGroupMemberMutationOptions(),
    );

    await expect(
      observer.mutate({ groupId: "group-1", userId: "user-1" }),
    ).rejects.toThrow(
      "Changes are unavailable until the secure connection is ready.",
    );
    expect(mutationMocks.addGroupMember).not.toHaveBeenCalled();
  });

  it("rejects a late membership response after logout", async () => {
    const client = createRomeoQueryClient();
    const queryKey = appQueryKeys.groups("group-1", "members");
    client.setQueryData(queryKey, []);
    let resolveAdd: ((value: GroupMember) => void) | undefined;
    mutationMocks.addGroupMember.mockImplementationOnce(
      () =>
        new Promise<GroupMember>((resolve) => {
          resolveAdd = resolve;
        }),
    );
    const observer = new MutationObserver(
      client,
      addGroupMemberMutationOptions(),
    );
    const pending = observer.mutate({
      groupId: "group-1",
      userId: "user-1",
    });
    await vi.waitFor(() => expect(resolveAdd).toBeDefined());

    await clearRouteDataForLogout(client);
    resolveAdd?.(member());
    await expect(pending).rejects.toThrow(
      "The authentication session changed.",
    );

    expect(client.getQueryData(queryKey)).toBeUndefined();
  });
});

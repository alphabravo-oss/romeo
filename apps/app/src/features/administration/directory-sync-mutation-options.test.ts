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
import { directorySyncMutationOptions } from "./directory-sync-mutation-options";
import type { DirectorySyncResult } from "./types";

const mutationMocks = vi.hoisted(() => ({ triggerDirectorySync: vi.fn() }));

vi.mock("./mutations", () => mutationMocks);

function syncResult(mode: "apply" | "preview"): DirectorySyncResult {
  return {
    changes: {
      membershipRemovals: {
        count: mode === "apply" ? 1 : 0,
        groups: [],
        skippedSelfUserIds: [],
      },
      userDisables: {
        count: mode === "apply" ? 1 : 0,
        skippedAdminUserIds: [],
        skippedSelfUserIds: [],
        userIds: mode === "apply" ? ["user-1"] : [],
      },
    },
    generatedAt: "2026-08-14T00:00:00.000Z",
    limits: { maxMembershipRemovals: 10, maxUserDisables: 10 },
    mode,
    orgId: "org-1",
    redaction: {
      externalGroupNamesReturned: false,
      externalSubjectIdsReturned: false,
      rawDirectoryPayloadReturned: false,
      userEmailsReturned: false,
      userNamesReturned: false,
    },
    requested: {
      disableMissingUsers: true,
      preserveAdminUsers: true,
      removeMissingGroupMembers: true,
    },
    schema: "romeo.directory-sync.v1",
    source: "scim",
    status: mode === "apply" ? "applied" : "preview",
    warnings: [],
  };
}

describe("directory sync mutation policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completeMutationNetworkRevalidation();
    advanceMutationSessionBoundary();
  });

  it("keeps a preview side-effect free and cache-stable", async () => {
    const client = createRomeoQueryClient();
    const usersKey = appQueryKeys.users({
      direction: "asc",
      page: 0,
      query: "",
      sort: "name",
    });
    client.setQueryData(usersKey, { marker: "users" });
    mutationMocks.triggerDirectorySync.mockResolvedValueOnce(
      syncResult("preview"),
    );
    const observer = new MutationObserver(
      client,
      directorySyncMutationOptions(),
    );

    const result = await observer.mutate({ dryRun: true, source: "scim" });

    expect(result.mode).toBe("preview");
    expect(client.getQueryData(usersKey)).toEqual({ marker: "users" });
    expect(client.getQueryState(usersKey)?.isInvalidated).toBe(false);
  });

  it("invalidates every concrete user/group view exactly after apply", async () => {
    const client = createRomeoQueryClient();
    const usersFirst = appQueryKeys.users({
      direction: "asc",
      page: 0,
      query: "",
      sort: "name",
    });
    const usersFiltered = appQueryKeys.users({
      direction: "desc",
      page: 2,
      query: "admin",
      sort: "role",
    });
    const groupsKey = appQueryKeys.groups();
    const membersKey = appQueryKeys.groups("group-1", "members");
    const unrelated = appQueryKeys.apiKeys();
    for (const queryKey of [
      usersFirst,
      usersFiltered,
      groupsKey,
      membersKey,
      unrelated,
    ]) {
      client.setQueryData(queryKey, []);
    }
    mutationMocks.triggerDirectorySync.mockResolvedValueOnce(
      syncResult("apply"),
    );
    const observer = new MutationObserver(
      client,
      directorySyncMutationOptions(),
    );

    await observer.mutate({
      confirmApply: "apply-directory-sync",
      dryRun: false,
      source: "scim",
    });

    for (const queryKey of [usersFirst, usersFiltered, groupsKey, membersKey]) {
      expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
    }
    expect(client.getQueryState(unrelated)?.isInvalidated).toBe(false);
  });

  it("leaves caches unchanged after conflict or authorization failure", async () => {
    const client = createRomeoQueryClient();
    const usersKey = appQueryKeys.users({
      direction: "asc",
      page: 0,
      query: "",
      sort: "name",
    });
    client.setQueryData(usersKey, { marker: "users" });
    const observer = new MutationObserver(
      client,
      directorySyncMutationOptions(),
    );

    for (const error of ["version_conflict", "forbidden"]) {
      mutationMocks.triggerDirectorySync.mockRejectedValueOnce(
        new Error(error),
      );
      await expect(
        observer.mutate({
          confirmApply: "apply-directory-sync",
          dryRun: false,
          source: "scim",
        }),
      ).rejects.toThrow(error);
    }

    expect(client.getQueryData(usersKey)).toEqual({ marker: "users" });
    expect(client.getQueryState(usersKey)?.isInvalidated).toBe(false);
  });

  it("executes no directory write while offline", async () => {
    const client = createRomeoQueryClient();
    markMutationNetworkOffline();
    const observer = new MutationObserver(
      client,
      directorySyncMutationOptions(),
    );

    await expect(
      observer.mutate({ dryRun: true, source: "scim" }),
    ).rejects.toThrow(
      "Changes are unavailable until the secure connection is ready.",
    );
    expect(mutationMocks.triggerDirectorySync).not.toHaveBeenCalled();
  });

  it("rejects late PII-bearing input after logout and retains no cache state", async () => {
    const client = createRomeoQueryClient();
    let resolveSync: ((value: DirectorySyncResult) => void) | undefined;
    mutationMocks.triggerDirectorySync.mockImplementationOnce(
      () =>
        new Promise<DirectorySyncResult>((resolve) => {
          resolveSync = resolve;
        }),
    );
    const observer = new MutationObserver(
      client,
      directorySyncMutationOptions(),
    );
    const pending = observer.mutate({
      dryRun: true,
      presentUserEmails: ["private@example.com"],
      reason: "PRIVATE_DIRECTORY_REASON",
      source: "scim",
    });
    await vi.waitFor(() => expect(resolveSync).toBeDefined());

    await clearRouteDataForLogout(client);
    resolveSync?.(syncResult("preview"));
    await expect(pending).rejects.toThrow(
      "The authentication session changed.",
    );
    observer.reset();

    const cacheState = JSON.stringify({
      mutations: client.getMutationCache().getAll(),
      queries: client.getQueryCache().getAll(),
    });
    expect(cacheState).not.toContain("private@example.com");
    expect(cacheState).not.toContain("PRIVATE_DIRECTORY_REASON");
  });
});

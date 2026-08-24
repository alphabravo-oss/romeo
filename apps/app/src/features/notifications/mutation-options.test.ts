import type { UserNotification } from "@romeo/api-client/generated/sdk";
import { MutationObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as appQueryKeys from "../../lib/app-query-keys";
import { completeMutationNetworkRevalidation } from "../../lib/connectivity";
import { advanceMutationSessionBoundary } from "../../lib/mutation-session-boundary";
import { createRomeoQueryClient } from "../../lib/query-client";
import { markNotificationReadMutationOptions } from "./mutation-options";

const mutationMocks = vi.hoisted(() => ({
  markNotificationRead: vi.fn(),
}));

vi.mock("./mutations", () => ({
  createNotificationChannel: vi.fn(),
  markNotificationRead: mutationMocks.markNotificationRead,
  updateNotificationPolicy: vi.fn(),
}));

describe("notification mutation policies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completeMutationNetworkRevalidation();
    advanceMutationSessionBoundary();
  });

  it("reconciles mark-read into the visible inventory", async () => {
    const client = createRomeoQueryClient();
    const tableKey = appQueryKeys.tablePages({
      filters: [],
      limit: 25,
      resource: "notifications",
      sort: [],
    });
    client.setQueryData(tableKey, { items: [] });
    const notification = {
      id: "notification-1",
      readAt: "2026-08-23T00:00:00.000Z",
    } as UserNotification;
    mutationMocks.markNotificationRead.mockResolvedValueOnce(notification);
    const observer = new MutationObserver(
      client,
      markNotificationReadMutationOptions(),
    );

    await observer.mutate(notification.id);

    expect(client.getQueryState(tableKey)?.isInvalidated).toBe(true);
  });
});

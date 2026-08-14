import { MutationObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as appQueryKeys from "../../lib/app-query-keys";
import { completeMutationNetworkRevalidation } from "../../lib/connectivity";
import { advanceMutationSessionBoundary } from "../../lib/mutation-session-boundary";
import { createRomeoQueryClient } from "../../lib/query-client";
import type { WebhookSubscription } from "./types";
import {
  createWebhookMutationOptions,
  disableWebhookMutationOptions,
  testWebhookMutationOptions,
} from "./mutation-options";

const mutationMocks = vi.hoisted(() => ({
  bulkDisableWebhooks: vi.fn(),
  createWebhook: vi.fn(),
  disableWebhook: vi.fn(),
  testWebhook: vi.fn(),
}));

vi.mock("./mutations", () => mutationMocks);

const webhook = (disabledAt?: string): WebhookSubscription => ({
  createdAt: "2026-08-14T00:00:00.000Z",
  createdBy: "user-1",
  eventTypes: ["webhook.test"],
  id: "webhook-1",
  orgId: "org-1",
  updatedAt: "2026-08-14T00:00:00.000Z",
  url: "https://example.com/hook",
  ...(disabledAt === undefined ? {} : { disabledAt }),
});

describe("webhook mutation policies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completeMutationNetworkRevalidation();
    advanceMutationSessionBoundary();
  });

  it("never stores the one-time signing secret in query cache", async () => {
    const client = createRomeoQueryClient();
    const key = appQueryKeys.webhooks("workspace-1");
    client.setQueryData(key, []);
    mutationMocks.createWebhook.mockResolvedValueOnce({
      signingSecret: "whsec_DO_NOT_CACHE",
      subscription: webhook(),
    });
    const observer = new MutationObserver(
      client,
      createWebhookMutationOptions("workspace-1"),
    );

    await observer.mutate({
      eventTypes: ["webhook.test"],
      url: "https://example.com/hook",
    });

    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    expect(JSON.stringify(client.getQueryCache().getAll())).not.toContain(
      "whsec_DO_NOT_CACHE",
    );
  });

  it("rolls an optimistic disable back after authorization failure", async () => {
    const client = createRomeoQueryClient();
    const key = appQueryKeys.webhooks("workspace-1");
    client.setQueryData(key, [webhook()]);
    let rejectDisable!: (error: Error) => void;
    mutationMocks.disableWebhook.mockReturnValueOnce(
      new Promise<WebhookSubscription>((_resolve, reject) => {
        rejectDisable = reject;
      }),
    );
    const observer = new MutationObserver(
      client,
      disableWebhookMutationOptions("workspace-1"),
    );
    const mutation = observer.mutate("webhook-1");
    await vi.waitFor(() =>
      expect(
        client.getQueryData<WebhookSubscription[]>(key)?.[0]?.disabledAt,
      ).toBeDefined(),
    );

    rejectDisable(new Error("forbidden"));
    await expect(mutation).rejects.toThrow("forbidden");
    expect(client.getQueryData(key)).toEqual([webhook()]);
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
  });

  it("invalidates every delivery page for only the tested webhook", async () => {
    const client = createRomeoQueryClient();
    const firstPage = appQueryKeys.webhookDeliveries("webhook-1", {
      cursor: undefined,
      pageSize: 25,
    });
    const secondPage = appQueryKeys.webhookDeliveries("webhook-1", {
      cursor: "cursor-2",
      pageSize: 25,
    });
    const otherWebhook = appQueryKeys.webhookDeliveries("webhook-2", {
      cursor: undefined,
      pageSize: 25,
    });
    client.setQueryData(firstPage, { data: [] });
    client.setQueryData(secondPage, { data: [] });
    client.setQueryData(otherWebhook, { data: [] });
    mutationMocks.testWebhook.mockResolvedValueOnce({ id: "delivery-1" });
    const observer = new MutationObserver(client, testWebhookMutationOptions());

    await observer.mutate("webhook-1");

    expect(client.getQueryState(firstPage)?.isInvalidated).toBe(true);
    expect(client.getQueryState(secondPage)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherWebhook)?.isInvalidated).toBe(false);
  });
});

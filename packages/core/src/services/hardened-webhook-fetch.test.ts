import { describe, expect, it, vi } from "vitest";

import { hardenedWebhookFetch } from "./hardened-webhook-fetch";

describe("hardened webhook fetch", () => {
  it("pins an approved public DNS answer and returns a bounded response", async () => {
    const pinnedFetchImpl = vi.fn(async () => new Response("ok"));
    const response = await hardenedWebhookFetch(
      "https://hooks.example.com/delivery",
      { method: "POST", body: "{}" },
      {
        allowedHosts: ["hooks.example.com"],
        egressPolicy: "require_allowlist",
        hostLookup: async () => [{ address: "93.184.216.34", family: 4 }],
        pinnedFetchImpl,
      },
    );

    expect(await response.text()).toBe("ok");
    expect(pinnedFetchImpl).toHaveBeenCalledWith(
      new URL("https://hooks.example.com/delivery"),
      expect.objectContaining({ redirect: "manual" }),
      [{ address: "93.184.216.34", family: 4 }],
    );
  });

  it("denies literal/private DNS targets and revalidates redirects", async () => {
    await expect(
      hardenedWebhookFetch("https://127.0.0.1/hook", { method: "POST" }),
    ).rejects.toThrow("private or local network");
    await expect(
      hardenedWebhookFetch(
        "https://hooks.example.com/hook",
        {},
        {
          hostLookup: async () => [{ address: "10.0.0.2", family: 4 }],
        },
      ),
    ).rejects.toThrow("private or local network");
    await expect(
      hardenedWebhookFetch(
        "https://hooks.example.com/hook",
        {},
        {
          fetchImpl: async () =>
            new Response(null, {
              status: 302,
              headers: { location: "https://169.254.169.254/latest" },
            }),
        },
      ),
    ).rejects.toThrow("private or local network");
  });

  it("fails on unsafe redirects, oversized bodies, and timeouts", async () => {
    await expect(
      hardenedWebhookFetch(
        "https://hooks.example.com/hook",
        {},
        {
          fetchImpl: async () =>
            new Response(null, {
              status: 302,
              headers: { location: "http://hooks.example.com/plaintext" },
            }),
        },
      ),
    ).rejects.toThrow("credential-free HTTPS");
    await expect(
      hardenedWebhookFetch(
        "https://hooks.example.com/hook",
        {},
        {
          fetchImpl: async () => new Response("too large"),
          maxResponseBytes: 3,
        },
      ),
    ).rejects.toThrow("byte limit");
    await expect(
      hardenedWebhookFetch(
        "https://hooks.example.com/hook",
        {},
        {
          fetchImpl: async (_url, init) =>
            await new Promise((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () =>
                reject(new Error("aborted")),
              );
            }),
          timeoutMs: 5,
        },
      ),
    ).rejects.toThrow("aborted");
  });
});

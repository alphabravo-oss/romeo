import { describe, expect, it } from "vitest";

import { GovernedWebFetcher } from "./governed-web-fetch";

describe("governed web fetch", () => {
  it("retries transient responses and returns the final successful body", async () => {
    const statuses: number[] = [];
    const fetcher = new GovernedWebFetcher({
      allowedHosts: ["docs.example.com"],
      retryAttempts: 1,
      retryBackoffMs: 0,
      fetchImpl: async () => {
        statuses.push(statuses.length === 0 ? 503 : 200);
        if (statuses.length === 1)
          return new Response("temporary", {
            status: 503,
            headers: { "retry-after": "0", "content-type": "text/plain" },
          });
        return new Response("final successful response", {
          headers: { "content-type": "text/plain" },
        });
      },
    });

    const result = await fetcher.fetchUrl("https://docs.example.com/retry");

    expect(statuses).toEqual([503, 200]);
    expect(result).toMatchObject({
      content: "final successful response",
      finalUrl: "https://docs.example.com/retry",
      mimeType: "text/plain",
    });
  });

  it("blocks hosts outside the allowlist before fetching", async () => {
    const fetches: string[] = [];
    const fetcher = new GovernedWebFetcher({
      allowedHosts: ["allowed.example.com"],
      fetchImpl: async (input) => {
        fetches.push(String(input));
        return new Response("should not fetch");
      },
    });

    await expect(
      fetcher.fetchUrl("https://blocked.example.com/guide"),
    ).rejects.toMatchObject({ code: "connector_egress_host_blocked" });
    expect(fetches).toEqual([]);
  });

  it("blocks hosts that resolve to a private address before fetching", async () => {
    const fetches: string[] = [];
    const fetcher = new GovernedWebFetcher({
      allowedHosts: ["docs.example.com"],
      hostLookup: async () => [{ address: "10.42.0.15", family: 4 }],
      fetchImpl: async (input) => {
        fetches.push(String(input));
        return new Response("should not fetch");
      },
    });

    await expect(
      fetcher.fetchUrl("https://docs.example.com/guide"),
    ).rejects.toMatchObject({ code: "connector_private_network_host_blocked" });
    expect(fetches).toEqual([]);
  });

  it("rejects responses larger than the configured byte limit", async () => {
    const fetcher = new GovernedWebFetcher({
      maxBytes: 4,
      fetchImpl: async () =>
        new Response("too large", {
          headers: { "content-type": "text/plain" },
        }),
    });

    await expect(
      fetcher.fetchUrl("https://docs.example.com/large"),
    ).rejects.toMatchObject({ code: "connector_response_too_large" });
  });

  it("rejects non-HTTP URLs", async () => {
    await expect(
      new GovernedWebFetcher().fetchUrl("file:///etc/passwd"),
    ).rejects.toMatchObject({ code: "connector_url_protocol_invalid" });
  });
});

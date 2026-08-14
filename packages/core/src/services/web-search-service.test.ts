import { scopeValues, type AuthSubject } from "@romeo/auth";
import { describe, expect, it, vi } from "vitest";

import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { assertConnectorHostAllowed } from "./data-connector-executors";
import { EnvironmentSecretResolver } from "./secret-resolver";
import { WebSearchService } from "./web-search-service";

const subject: AuthSubject = {
  id: "user_dev_admin",
  type: "user",
  orgId: "org_default",
  workspaceIds: ["workspace_default"],
  groupIds: [],
  scopes: [...scopeValues],
  isAdmin: true,
};

const publicLookup = async () => [
  { address: "93.184.216.34", family: 4 as const },
];

describe("governed web retrieval", () => {
  it.each([
    "http://[::1]/",
    "http://[fc00::1]/",
    "http://[fe80::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[64:ff9b::7f00:1]/",
  ])("blocks non-public IPv6 target %s", async (url) => {
    await expect(
      assertConnectorHostAllowed(new URL(url)),
    ).rejects.toMatchObject({
      code: "connector_private_network_host_blocked",
      status: 403,
    });
  });

  it("allows a globally routable IPv6 literal", async () => {
    await expect(
      assertConnectorHostAllowed(new URL("https://[2606:4700:4700::1111]/")),
    ).resolves.toEqual([]);
  });

  it("rejects a public hostname when DNS resolves it to a private address", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const service = new WebSearchService(new InMemoryRomeoRepository(), {
      fetchImpl,
      hostLookup: async () => [{ address: "127.0.0.1", family: 4 }],
    });
    await service.updateConfiguration(subject, {
      enabled: true,
      endpointUrl: "https://search.example.test/search",
    });

    await expect(
      service.search(subject, "private DNS sentinel"),
    ).rejects.toMatchObject({
      code: "connector_private_network_host_blocked",
      status: 403,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("pins the provider socket to the public addresses accepted by policy", async () => {
    const pinnedFetchImpl = vi.fn(async (_url, _init, addresses) => {
      expect(addresses).toEqual([{ address: "93.184.216.34", family: 4 }]);
      return new Response(JSON.stringify({ results: [] }), {
        headers: { "content-type": "application/json" },
      });
    });
    const service = new WebSearchService(new InMemoryRomeoRepository(), {
      hostLookup: publicLookup,
      pinnedFetchImpl,
    });
    await service.updateConfiguration(subject, {
      enabled: true,
      endpointUrl: "https://search.example.test/search",
    });

    await expect(
      service.search(subject, "pinned search sentinel"),
    ).resolves.toEqual([]);
    expect(pinnedFetchImpl).toHaveBeenCalledOnce();
  });

  it("resolves, validates, and pins every provider redirect hop independently", async () => {
    const observations: Array<{ host: string; address: string }> = [];
    const pinnedFetchImpl = vi.fn(async (url, _init, addresses) => {
      observations.push({
        host: url.hostname,
        address: addresses[0]?.address ?? "missing",
      });
      if (observations.length === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://redirect.example.test/search" },
        });
      }
      return new Response(JSON.stringify({ results: [] }), {
        headers: { "content-type": "application/json" },
      });
    });
    const service = new WebSearchService(new InMemoryRomeoRepository(), {
      hostLookup: async (hostname) => [
        {
          address:
            hostname === "search.example.test"
              ? "93.184.216.34"
              : "93.184.216.35",
          family: 4,
        },
      ],
      pinnedFetchImpl,
    });
    await service.updateConfiguration(subject, {
      enabled: true,
      endpointUrl: "https://search.example.test/search",
    });

    await expect(
      service.search(subject, "redirect pin sentinel"),
    ).resolves.toEqual([]);
    expect(observations).toEqual([
      { host: "search.example.test", address: "93.184.216.34" },
      { host: "redirect.example.test", address: "93.184.216.35" },
    ]);
  });

  it("uses the pinned transport for governed URL ingestion", async () => {
    const pinnedFetchImpl = vi.fn(async (url, _init, addresses) => {
      expect(url.hostname).toBe("docs.example.test");
      expect(addresses).toEqual([{ address: "93.184.216.34", family: 4 }]);
      return new Response("<title>Pinned page</title><p>governed content</p>", {
        headers: { "content-type": "text/html" },
      });
    });
    const service = new WebSearchService(new InMemoryRomeoRepository(), {
      hostLookup: publicLookup,
      pinnedFetchImpl,
    });
    await service.updateConfiguration(subject, {
      enabled: true,
      allowedDomains: ["example.test"],
    });

    await expect(
      service.ingestUrls(subject, ["https://docs.example.test/page"]),
    ).resolves.toMatchObject([{ title: "Pinned page", sourceType: "url" }]);
    expect(pinnedFetchImpl).toHaveBeenCalledOnce();
  });

  it("applies blocked-domain policy to every URL-ingestion redirect hop", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "https://blocked.example.test/private" },
      }),
    );
    const service = new WebSearchService(new InMemoryRomeoRepository(), {
      fetchImpl,
      hostLookup: publicLookup,
    });
    await service.updateConfiguration(subject, {
      enabled: true,
      blockedDomains: ["example.test"],
    });

    await expect(
      service.ingestUrls(subject, ["https://93.184.216.34/document"]),
    ).rejects.toMatchObject({
      code: "connector_egress_host_blocked",
      status: 403,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("gives blocked domains precedence over an overlapping allowlist", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const service = new WebSearchService(new InMemoryRomeoRepository(), {
      fetchImpl,
      hostLookup: publicLookup,
    });
    await service.updateConfiguration(subject, {
      enabled: true,
      allowedDomains: ["example.test"],
      blockedDomains: ["blocked.example.test"],
    });

    await expect(
      service.ingestUrls(subject, ["https://blocked.example.test/document"]),
    ).rejects.toMatchObject({ code: "web_domain_blocked", status: 403 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("drops provider credentials on cross-origin redirects", async () => {
    const observedHeaders: Headers[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      observedHeaders.push(new Headers(init?.headers));
      if (observedHeaders.length === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://redirect.example.test/search" },
        });
      }
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const service = new WebSearchService(new InMemoryRomeoRepository(), {
      fetchImpl,
      hostLookup: publicLookup,
      secretResolver: new EnvironmentSecretResolver({
        WEB_SEARCH_API_KEY: "cross-origin-secret-sentinel",
      }),
    });
    await service.updateConfiguration(subject, {
      enabled: true,
      provider: "brave",
      endpointUrl: "https://search.example.test/search",
      credentialRef: "env://WEB_SEARCH_API_KEY",
    });

    await expect(
      service.search(subject, "credential redirect sentinel"),
    ).resolves.toEqual([]);
    expect(observedHeaders).toHaveLength(2);
    expect(observedHeaders[0]?.get("x-subscription-token")).toBe(
      "cross-origin-secret-sentinel",
    );
    expect(observedHeaders[1]?.has("x-subscription-token")).toBe(false);
  });

  it("bounds provider redirect chains", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const current = new URL(String(input));
      const hop = Number(current.searchParams.get("hop") ?? "0");
      return new Response(null, {
        status: 302,
        headers: {
          location: `https://search.example.test/search?hop=${hop + 1}`,
        },
      });
    });
    const service = new WebSearchService(new InMemoryRomeoRepository(), {
      fetchImpl,
      hostLookup: publicLookup,
    });
    await service.updateConfiguration(subject, {
      enabled: true,
      endpointUrl: "https://search.example.test/search",
    });

    await expect(
      service.search(subject, "redirect loop sentinel"),
    ).rejects.toMatchObject({
      code: "web_search_redirect_limit_exceeded",
      status: 502,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it("deduplicates equivalent provider results and records access freshness", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              title: "Primary",
              url: "https://docs.example.test/guide",
              content: "one",
            },
            {
              title: "Duplicate",
              url: "https://docs.example.test/guide#section",
              content: "two",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const service = new WebSearchService(new InMemoryRomeoRepository(), {
      fetchImpl,
    });
    await service.updateConfiguration(subject, {
      enabled: true,
      endpointUrl: "https://93.184.216.34/search",
    });

    const results = await service.search(subject, "deduplication sentinel");

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      title: "Primary",
      url: "https://docs.example.test/guide",
      sourceType: "web_search",
    });
    expect(Number.isFinite(Date.parse(results[0]!.accessedAt))).toBe(true);
  });

  it("enforces publication freshness and exposes persisted provider health", async () => {
    const recent = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const old = new Date(Date.now() - 90 * 86_400_000).toISOString();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              title: "Recent",
              url: "https://docs.example.test/recent",
              content: "recent",
              published_at: recent,
            },
            {
              title: "Old",
              url: "https://docs.example.test/old",
              content: "old",
              published_at: old,
            },
            {
              title: "Unknown",
              url: "https://docs.example.test/unknown",
              content: "unknown",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const repository = new InMemoryRomeoRepository();
    const service = new WebSearchService(repository, { fetchImpl });
    await service.updateConfiguration(subject, {
      enabled: true,
      endpointUrl: "https://93.184.216.34/search",
      freshnessMaxAgeDays: 30,
      unknownPublicationDatePolicy: "exclude",
    });

    await expect(
      service.search(subject, "freshness sentinel"),
    ).resolves.toMatchObject([{ title: "Recent", publishedAt: recent }]);
    await expect(service.configuration(subject)).resolves.toMatchObject({
      freshnessMaxAgeDays: 30,
      unknownPublicationDatePolicy: "exclude",
      health: { status: "healthy", latencyMs: expect.any(Number) },
    });
    const usage = await repository.listUsageEvents(subject.orgId);
    expect(usage).toHaveLength(2);
    expect(usage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: "retrieval",
          metric: "web.search.request",
          quantity: 1,
          unit: "request",
          metadata: expect.objectContaining({
            outcome: "success",
            resultCount: 1,
          }),
        }),
        expect.objectContaining({
          sourceType: "retrieval",
          metric: "retrieval.unit",
          quantity: 1,
          unit: "retrieval_unit",
          metadata: {
            operation: "search_result",
            provider: "searxng",
          },
        }),
      ]),
    );
  });

  it("enforces search request quotas before provider dispatch", async () => {
    const repository = new InMemoryRomeoRepository();
    const now = new Date().toISOString();
    await repository.createQuotaBucket({
      id: "quota_web_search_zero",
      orgId: subject.orgId,
      scopeType: "org",
      scopeId: subject.orgId,
      metric: "web.search.request",
      limit: 0,
      used: 0,
      resetInterval: "none",
      createdAt: now,
      updatedAt: now,
    });
    const fetchImpl = vi.fn<typeof fetch>();
    const service = new WebSearchService(repository, { fetchImpl });
    await service.updateConfiguration(subject, {
      enabled: true,
      endpointUrl: "https://93.184.216.34/search",
    });

    await expect(
      service.search(subject, "quota sentinel"),
    ).rejects.toMatchObject({
      code: "quota_exceeded",
      status: 429,
      details: { metric: "web.search.request" },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("enforces URL-fetch quotas for the full requested batch", async () => {
    const repository = new InMemoryRomeoRepository();
    const now = new Date().toISOString();
    await repository.createQuotaBucket({
      id: "quota_web_url_one",
      orgId: subject.orgId,
      scopeType: "org",
      scopeId: subject.orgId,
      metric: "web.url.fetch",
      limit: 1,
      used: 0,
      resetInterval: "none",
      createdAt: now,
      updatedAt: now,
    });
    const fetchImpl = vi.fn<typeof fetch>();
    const service = new WebSearchService(repository, { fetchImpl });
    await service.updateConfiguration(subject, { enabled: true });

    await expect(
      service.ingestUrls(subject, [
        "https://93.184.216.34/one",
        "https://93.184.216.34/two",
      ]),
    ).rejects.toMatchObject({
      code: "quota_exceeded",
      details: { metric: "web.url.fetch", requested: 2 },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("skips unreachable URLs without suppressing policy failures", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url =
        input instanceof Request ? new URL(input.url) : new URL(String(input));
      if (url.hostname.includes("unreachable"))
        throw new TypeError("network unavailable");
      return new Response("<title>Reachable</title><p>content</p>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    });
    const service = new WebSearchService(new InMemoryRomeoRepository(), {
      fetchImpl,
      hostLookup: publicLookup,
    });
    await service.updateConfiguration(subject, {
      enabled: true,
      unreachableUrlPolicy: "skip",
      blockedDomains: ["blocked.example.test"],
    });

    await expect(
      service.ingestUrls(subject, [
        "https://reachable.example.test/page",
        "https://unreachable.example.test/page",
      ]),
    ).resolves.toMatchObject([{ title: "Reachable" }]);
    await expect(
      service.ingestUrls(subject, [
        "https://blocked.example.test/page",
        "https://unreachable.example.test/page",
      ]),
    ).rejects.toMatchObject({ code: "web_domain_blocked", status: 403 });
  });

  it("persists a sanitized degraded health state after provider failure", async () => {
    const service = new WebSearchService(new InMemoryRomeoRepository(), {
      fetchImpl: vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("unavailable", { status: 503 })),
    });
    await service.updateConfiguration(subject, {
      enabled: true,
      endpointUrl: "https://93.184.216.34/search",
    });

    await expect(
      service.search(subject, "failure sentinel"),
    ).rejects.toMatchObject({
      code: "web_search_provider_failed",
    });
    await expect(service.configuration(subject)).resolves.toMatchObject({
      health: {
        status: "degraded",
        lastErrorCode: "web_search_provider_failed",
        latencyMs: expect.any(Number),
      },
    });
  });

  it("aborts stalled search providers with a stable timeout and degraded health", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    const service = new WebSearchService(new InMemoryRomeoRepository(), {
      fetchImpl,
      timeoutMs: 5,
    });
    await service.updateConfiguration(subject, {
      enabled: true,
      endpointUrl: "https://93.184.216.34/search",
    });

    await expect(
      service.search(subject, "timeout sentinel"),
    ).rejects.toMatchObject({
      code: "web_search_provider_timeout",
      status: 504,
    });
    await expect(service.configuration(subject)).resolves.toMatchObject({
      health: {
        status: "degraded",
        lastErrorCode: "web_search_provider_timeout",
      },
    });
  });
});

import { describe, expect, it, vi } from "vitest";

import type { WebsiteConnectorHostAddress } from "./outbound-network-policy";
import {
  SecretBearingEgressClient,
  SecretBearingEgressError,
} from "./secret-bearing-egress";

const publicAddresses: WebsiteConnectorHostAddress[] = [
  { address: "93.184.216.34", family: 4 },
  { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
];

describe("SecretBearingEgressClient", () => {
  it("pins every approved DNS answer and preserves the reviewed URL", async () => {
    const pinnedFetchImpl = vi.fn(async () =>
      Promise.resolve(new Response('{"ok":true}')),
    );
    const client = clientWith({ pinnedFetchImpl });

    await client.fetch("https://tokens.example.com/oauth/token", {
      method: "POST",
      body: "client_secret=do-not-log",
    });

    expect(pinnedFetchImpl).toHaveBeenCalledWith(
      new URL("https://tokens.example.com/oauth/token"),
      expect.objectContaining({ method: "POST", redirect: "manual" }),
      publicAddresses,
    );
  });

  it.each([
    "http://tokens.example.com/oauth/token",
    "https://user:password@tokens.example.com/oauth/token",
    "https://tokens.example.com/oauth/token#fragment",
    "https://tokens.example.com.evil.test/oauth/token",
    "https://tokens.example.com/oauth/other",
    "https://tokens.example.com:444/oauth/token",
    "https://127.0.0.1/oauth/token",
    "https://0x7f000001/oauth/token",
    "https://0177.0.0.1/oauth/token",
    "https://127.1/oauth/token",
    "https://2130706433/oauth/token",
    "https://[::ffff:127.0.0.1]/oauth/token",
    "https://[64:ff9b::7f00:1]/oauth/token",
    "https://metadata.google.internal/oauth/token",
  ])("blocks an unreviewed or local destination: %s", async (url) => {
    const client = clientWith();
    await expect(client.fetch(url)).rejects.toBeInstanceOf(
      SecretBearingEgressError,
    );
  });

  it.each([
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "::1",
    "fe80::1",
    "fd00::1",
    "::ffff:127.0.0.1",
  ])("rejects a DNS set containing %s before transport", async (address) => {
    const pinnedFetchImpl = vi.fn();
    const client = clientWith({
      hostLookup: async () => [
        publicAddresses[0]!,
        { address, family: address.includes(":") ? 6 : 4 },
      ],
      pinnedFetchImpl,
    });
    await expect(
      client.fetch("https://tokens.example.com/oauth/token"),
    ).rejects.toMatchObject({ code: "secret_egress_dns_denied" });
    expect(pinnedFetchImpl).not.toHaveBeenCalled();
  });

  it("blocks credential redirects even when the target origin is approved", async () => {
    const client = clientWith({
      pinnedFetchImpl: async () =>
        new Response(null, {
          status: 307,
          headers: { location: "https://api.example.com/capture" },
        }),
    });
    await expect(
      client.fetch("https://tokens.example.com/oauth/token", {
        method: "POST",
        body: "client_secret=do-not-log",
      }),
    ).rejects.toMatchObject({ code: "secret_egress_redirect_blocked" });
  });

  it("re-resolves retries and blocks a later DNS rebind", async () => {
    const hostLookup = vi
      .fn()
      .mockResolvedValueOnce(publicAddresses)
      .mockResolvedValueOnce([{ address: "10.0.0.8", family: 4 }]);
    const pinnedFetchImpl = vi.fn(async () => new Response("{}"));
    const client = clientWith({ hostLookup, pinnedFetchImpl });
    await client.fetch("https://tokens.example.com/oauth/token");
    await expect(
      client.fetch("https://tokens.example.com/oauth/token"),
    ).rejects.toMatchObject({ code: "secret_egress_dns_denied" });
    expect(hostLookup).toHaveBeenCalledTimes(2);
    expect(pinnedFetchImpl).toHaveBeenCalledOnce();
  });

  it("fails closed when resolution is enabled without a pinned transport", async () => {
    const client = new SecretBearingEgressClient({
      allowedUrls: ["https://tokens.example.com/oauth/token"],
      fetchImpl: async () => new Response("{}"),
      hostLookup: async () => publicAddresses,
    });
    await expect(
      client.fetch("https://tokens.example.com/oauth/token"),
    ).rejects.toMatchObject({
      code: "secret_egress_dns_pinning_unavailable",
    });
  });

  it("rejects declared and streamed oversized responses", async () => {
    const declared = clientWith({
      maxResponseBytes: 4,
      pinnedFetchImpl: async () =>
        new Response("", { headers: { "content-length": "5" } }),
    });
    await expect(
      declared.fetch("https://tokens.example.com/oauth/token"),
    ).rejects.toMatchObject({ code: "secret_egress_response_too_large" });

    const streamed = clientWith({
      maxResponseBytes: 4,
      pinnedFetchImpl: async () => new Response("12345"),
    });
    await expect(
      streamed.fetch("https://tokens.example.com/oauth/token"),
    ).rejects.toMatchObject({ code: "secret_egress_response_too_large" });
  });

  it("preserves provider-stream backpressure while enforcing the byte bound", async () => {
    const neverFinishes = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("first"));
      },
    });
    const client = clientWith({
      maxResponseBytes: 8,
      pinnedFetchImpl: async () => new Response(neverFinishes),
      responseMode: "streaming",
    });
    const response = await client.fetch(
      "https://tokens.example.com/oauth/token",
    );
    const reader = response.body!.getReader();
    await expect(reader.read()).resolves.toMatchObject({ done: false });
    await reader.cancel();

    const oversized = clientWith({
      maxResponseBytes: 4,
      pinnedFetchImpl: async () => new Response("12345"),
      responseMode: "streaming",
    });
    const oversizedResponse = await oversized.fetch(
      "https://tokens.example.com/oauth/token",
    );
    await expect(oversizedResponse.text()).rejects.toMatchObject({
      code: "secret_egress_response_too_large",
    });
  });

  it("keeps the hard deadline active for a transport that ignores abort", async () => {
    const client = clientWith({
      pinnedFetchImpl: async () =>
        new Response(
          new ReadableStream({
            pull: async () => await new Promise(() => undefined),
          }),
        ),
      responseMode: "streaming",
      timeoutMs: 5,
    });
    const response = await client.fetch(
      "https://tokens.example.com/oauth/token",
    );
    await expect(response.text()).rejects.toMatchObject({
      code: "secret_egress_timeout",
    });
  });

  it("times out DNS resolution and does not disclose request secrets", async () => {
    const client = clientWith({
      hostLookup: async () => await new Promise(() => undefined),
      timeoutMs: 1,
    });
    const caught = await client
      .fetch("https://tokens.example.com/oauth/token", {
        headers: { authorization: "Bearer top-secret" },
        body: "client_secret=top-secret",
        method: "POST",
      })
      .catch((error: unknown) => error);
    expect(caught).toMatchObject({ code: "secret_egress_timeout" });
    expect(String(caught)).not.toContain("top-secret");
    expect(JSON.stringify(caught)).not.toContain("top-secret");
  });

  it("permits variable resource paths only on a separately reviewed origin", async () => {
    const client = clientWith();
    await expect(
      client.fetch("https://api.example.com/repos/acme/example?per_page=100"),
    ).resolves.toBeInstanceOf(Response);
  });
});

function clientWith(
  overrides: Partial<
    ConstructorParameters<typeof SecretBearingEgressClient>[0]
  > = {},
): SecretBearingEgressClient {
  return new SecretBearingEgressClient({
    allowedOrigins: ["https://api.example.com"],
    allowedUrls: ["https://tokens.example.com/oauth/token"],
    hostLookup: async () => publicAddresses,
    maxResponseBytes: 1024,
    pinnedFetchImpl: async () => new Response("{}"),
    timeoutMs: 500,
    ...overrides,
  });
}

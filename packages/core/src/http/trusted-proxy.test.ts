import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import type { AppBindings } from "./context";
import { resolveTrustedProxy, trustedForwardedProtocol } from "./trusted-proxy";

const basePolicy = {
  EDGE_TRUSTED_PROXY_MODE: "trusted_proxy" as const,
  EDGE_TRUSTED_PROXY_HOPS: 1,
  EDGE_TRUSTED_PROXY_CIDRS: "10.42.0.0/16,2001:db8:42::/48",
};

function proxyApp(policy = basePolicy) {
  const app = new Hono<AppBindings>();
  app.get("/", (context) => {
    const resolution = resolveTrustedProxy(context, policy);
    return context.json({
      ...resolution,
      protocol: trustedForwardedProtocol(context, resolution),
    });
  });
  return app;
}

describe("trusted proxy resolution", () => {
  it("trusts IPv4 and IPv6 peers only inside configured CIDRs", async () => {
    const app = proxyApp();
    for (const [peer, forwarded] of [
      ["10.42.3.9", "198.51.100.10"],
      ["2001:db8:42::9", "2001:db8:ffff::10"],
      ["::ffff:10.42.3.9", "203.0.113.10"],
    ] as const) {
      const response = await app.request(
        "/",
        {
          headers: {
            "x-forwarded-for": forwarded,
            "x-forwarded-proto": "https",
          },
        },
        { requestPeerAddress: peer },
      );
      await expect(response.json()).resolves.toMatchObject({
        clientAddress: forwarded,
        protocol: "https",
        trusted: true,
      });
    }
  });

  it("ignores spoofed forwarding metadata from an untrusted transport peer", async () => {
    const response = await proxyApp().request(
      "/",
      {
        headers: {
          "x-forwarded-for": "198.51.100.10",
          "x-forwarded-proto": "https",
        },
      },
      { requestPeerAddress: "203.0.113.200" },
    );
    await expect(response.json()).resolves.toEqual({
      peerAddress: "203.0.113.200",
      trusted: false,
    });
  });

  it("validates every configured intermediary instead of trusting hop count alone", async () => {
    const app = proxyApp({ ...basePolicy, EDGE_TRUSTED_PROXY_HOPS: 2 });
    const accepted = await app.request(
      "/",
      { headers: { "x-forwarded-for": "198.51.100.10,10.42.2.3" } },
      { requestPeerAddress: "10.42.1.2" },
    );
    const rejected = await app.request(
      "/",
      { headers: { "x-forwarded-for": "198.51.100.10,192.0.2.9" } },
      { requestPeerAddress: "10.42.1.2" },
    );
    await expect(accepted.json()).resolves.toMatchObject({
      clientAddress: "198.51.100.10",
      trusted: true,
    });
    await expect(rejected.json()).resolves.toMatchObject({ trusted: false });
  });

  it.each([
    ["empty element", "198.51.100.10,"],
    ["port suffix", "198.51.100.10:443"],
    ["unknown token", "unknown"],
    ["malformed IPv6", "2001:db8:::1"],
  ])("rejects a malformed forwarded chain: %s", async (_label, chain) => {
    const response = await proxyApp().request(
      "/",
      { headers: { "x-forwarded-for": chain } },
      { requestPeerAddress: "10.42.1.2" },
    );
    await expect(response.json()).resolves.toMatchObject({ trusted: false });
  });

  it("rejects malformed or ambiguous forwarded protocol chains", async () => {
    const response = await proxyApp().request(
      "/",
      {
        headers: {
          "x-forwarded-for": "198.51.100.10",
          "x-forwarded-proto": "https,ftp",
        },
      },
      { requestPeerAddress: "10.42.1.2" },
    );
    const body = await response.json();
    expect(body).toMatchObject({
      clientAddress: "198.51.100.10",
      trusted: true,
    });
    expect(body.protocol).toBeUndefined();
  });
});

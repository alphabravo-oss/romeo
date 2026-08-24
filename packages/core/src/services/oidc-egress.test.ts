import { describe, expect, it, vi } from "vitest";

import { OidcEgressClient } from "./oidc-egress";

const issuer = "https://identity.example.com";
const publicAddress = { address: "93.184.216.34", family: 4 as const };

describe("OIDC hardened egress", () => {
  it("blocks a private issuer before any transport call", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const egress = new OidcEgressClient("https://127.0.0.1", { fetchImpl });

    await expect(
      egress.fetchJson("https://127.0.0.1/.well-known/openid-configuration"),
    ).rejects.toThrow("oidc_private_network_host_blocked");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    "https://127.0.0.1/keys",
    "https://10.0.0.1/keys",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/keys",
    "https://[fe80::1]/keys",
    "https://[fc00::1]/keys",
  ])("blocks literal private or special-use endpoint %s", async (url) => {
    const fetchImpl = vi.fn<typeof fetch>();
    const egress = new OidcEgressClient(issuer, {
      allowedEndpointOrigins: [new URL(url).origin],
      fetchImpl,
    });

    await expect(egress.fetchJson(url)).rejects.toThrow(
      "oidc_private_network_host_blocked",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a DNS answer that resolves a public hostname to private space", async () => {
    const pinnedFetchImpl = vi.fn();
    const egress = new OidcEgressClient(issuer, {
      hostLookup: async () => [{ address: "127.0.0.1", family: 4 }],
      pinnedFetchImpl,
    });

    await expect(egress.fetchJson(`${issuer}/keys`)).rejects.toMatchObject({
      code: "connector_private_network_host_blocked",
    });
    expect(pinnedFetchImpl).not.toHaveBeenCalled();
  });

  it("pins an approved address and re-resolves every redirect hop", async () => {
    const lookups: string[] = [];
    const pinnedFetchImpl = vi.fn(async (url, _init, addresses) => {
      expect(addresses).toEqual([publicAddress]);
      return url.pathname === "/first"
        ? new Response(null, {
            status: 302,
            headers: { location: `${issuer}/second` },
          })
        : Response.json({ keys: [{ kid: "current" }] });
    });
    const egress = new OidcEgressClient(issuer, {
      hostLookup: async (hostname) => {
        lookups.push(hostname);
        return [publicAddress];
      },
      pinnedFetchImpl,
    });

    await expect(egress.fetchJson(`${issuer}/first`)).resolves.toEqual({
      keys: [{ kid: "current" }],
    });
    expect(lookups).toEqual(["identity.example.com", "identity.example.com"]);
    expect(pinnedFetchImpl).toHaveBeenCalledTimes(2);
  });

  it("blocks DNS rebinding on a later redirect hop", async () => {
    let lookupCount = 0;
    const pinnedFetchImpl = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: `${issuer}/rebound` },
        }),
    );
    const egress = new OidcEgressClient(issuer, {
      hostLookup: async () => {
        lookupCount += 1;
        return lookupCount === 1
          ? [publicAddress]
          : [{ address: "10.0.0.8", family: 4 }];
      },
      pinnedFetchImpl,
    });

    await expect(egress.fetchJson(`${issuer}/first`)).rejects.toMatchObject({
      code: "connector_private_network_host_blocked",
    });
    expect(pinnedFetchImpl).toHaveBeenCalledOnce();
  });

  it("revalidates and blocks redirects to private hosts", async () => {
    const pinnedFetchImpl = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://169.254.169.254/latest/meta-data" },
        }),
    );
    const egress = new OidcEgressClient(issuer, {
      allowedEndpointOrigins: ["https://169.254.169.254"],
      hostLookup: async () => [publicAddress],
      pinnedFetchImpl,
    });

    await expect(egress.fetchJson(`${issuer}/first`)).rejects.toThrow(
      "oidc_private_network_host_blocked",
    );
    expect(pinnedFetchImpl).toHaveBeenCalledOnce();
  });

  it("bounds redirect chains", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.redirect).toBe("manual");
      return new Response(null, {
        status: 302,
        headers: { location: `${issuer}/again` },
      });
    });
    const egress = new OidcEgressClient(issuer, { fetchImpl });

    await expect(egress.fetchJson(`${issuer}/first`)).rejects.toThrow(
      "oidc_redirect_limit_exceeded",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it.each([
    {
      init: { body: "client_secret=do-not-forward", method: "POST" },
      label: "token request body",
    },
    {
      init: { headers: { authorization: "Bearer do-not-forward" } },
      label: "authorization header",
    },
    {
      init: { headers: { cookie: "session=do-not-forward" } },
      label: "cookie header",
    },
  ])("never redirects a credential-bearing $label", async ({ init }) => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(null, {
          status: 307,
          headers: { location: `${issuer}/capture` },
        }),
    );
    const egress = new OidcEgressClient(issuer, { fetchImpl });

    await expect(egress.fetch(`${issuer}/token`, init)).rejects.toMatchObject({
      code: "oidc_credential_redirect_blocked",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("requires same-origin endpoints unless an exact HTTPS origin is allowed", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      Response.json({ keys: [] }),
    );
    const blocked = new OidcEgressClient(issuer, { fetchImpl });
    await expect(
      blocked.fetchJson("https://keys.example.net/jwks"),
    ).rejects.toThrow("oidc_endpoint_origin_blocked");

    const allowed = new OidcEgressClient(issuer, {
      allowedEndpointOrigins: ["https://keys.example.net"],
      fetchImpl,
    });
    await expect(
      allowed.fetchJson("https://keys.example.net/jwks"),
    ).resolves.toEqual({ keys: [] });
  });

  it("rejects declared and streamed responses over the byte cap", async () => {
    const declared = new OidcEgressClient(issuer, {
      fetchImpl: async () =>
        new Response("{}", { headers: { "content-length": "65" } }),
      maxResponseBytes: 64,
    });
    await expect(declared.fetchJson(`${issuer}/keys`)).rejects.toThrow(
      "oidc_response_too_large",
    );

    const streamed = new OidcEgressClient(issuer, {
      fetchImpl: async () => new Response("x".repeat(65)),
      maxResponseBytes: 64,
    });
    await expect(streamed.fetchJson(`${issuer}/keys`)).rejects.toThrow(
      "oidc_response_too_large",
    );
  });

  it("aborts an OIDC request at the configured deadline", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const egress = new OidcEgressClient(issuer, {
      fetchImpl,
      timeoutMs: 5,
    });

    await expect(egress.fetchJson(`${issuer}/keys`)).rejects.toThrow(
      "oidc_fetch_timeout",
    );
  });

  it("applies the same deadline while DNS resolution is pending", async () => {
    const pinnedFetchImpl = vi.fn();
    const egress = new OidcEgressClient(issuer, {
      hostLookup: async () => await new Promise(() => undefined),
      pinnedFetchImpl,
      timeoutMs: 5,
    });

    await expect(egress.fetchJson(`${issuer}/keys`)).rejects.toThrow(
      "oidc_fetch_timeout",
    );
    expect(pinnedFetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed when custom DNS resolution has no pinned transport", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({}));
    const egress = new OidcEgressClient(issuer, {
      fetchImpl,
      hostLookup: async () => [publicAddress],
    });

    await expect(egress.fetchJson(`${issuer}/keys`)).rejects.toMatchObject({
      code: "oidc_dns_pinning_unavailable",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

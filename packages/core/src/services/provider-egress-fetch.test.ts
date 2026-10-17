import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createProviderEgressFetch } from "./provider-egress-fetch";
import { providerNetworkPolicyFromEnv } from "./provider-network-policy";

const production = providerNetworkPolicyFromEnv({
  PROVIDER_PRIVATE_NETWORK_ALLOWED_HOSTS: "",
  ROMEO_ENV: "production",
});
const development = providerNetworkPolicyFromEnv({
  PROVIDER_PRIVATE_NETWORK_ALLOWED_HOSTS: "",
  ROMEO_ENV: "development",
});

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

async function listen(server: Server): Promise<number> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

describe("provider egress fetch", () => {
  it("denies a provider hostname whose DNS answer is private", async () => {
    const pinnedFetchImpl = vi.fn(async () => new Response("unexpected"));
    const providerFetch = createProviderEgressFetch({
      hostLookup: async () => [{ address: "10.0.0.5", family: 4 }],
      pinnedFetchImpl,
      policy: production,
    });

    await expect(
      providerFetch("http://10-0-0-5.nip.io/v1/models"),
    ).rejects.toMatchObject({
      code: "provider_egress_blocked",
      reason: "private_network_not_allowlisted",
    });
    expect(pinnedFetchImpl).not.toHaveBeenCalled();
  });

  it("pins an approved public answer and keeps the request intact", async () => {
    const pinnedFetchImpl = vi.fn(async () => Response.json({ data: [] }));
    const providerFetch = createProviderEgressFetch({
      hostLookup: async () => [{ address: "93.184.216.34", family: 4 }],
      pinnedFetchImpl,
      policy: production,
    });
    const form = new FormData();
    form.set("prompt", "a lighthouse");

    const response = await providerFetch(
      "https://api.example.com/v1/images/edits",
      { method: "POST", body: form, headers: { authorization: "Bearer k" } },
    );

    expect(await response.json()).toEqual({ data: [] });
    const [url, init, addresses] = pinnedFetchImpl.mock.calls[0] as unknown as [
      URL,
      RequestInit,
      unknown,
    ];
    expect(url.href).toBe("https://api.example.com/v1/images/edits");
    expect(addresses).toEqual([{ address: "93.184.216.34", family: 4 }]);
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer k");
    expect(headers.get("content-type")).toMatch(/^multipart\/form-data;/u);
    expect(init.body).toBeInstanceOf(Uint8Array);
    expect(init.redirect).toBe("manual");
  });

  it("re-checks redirects and never follows one into metadata", async () => {
    const pinnedFetchImpl = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data" },
        }),
    );
    const providerFetch = createProviderEgressFetch({
      hostLookup: async () => [{ address: "93.184.216.34", family: 4 }],
      pinnedFetchImpl,
      policy: providerNetworkPolicyFromEnv({
        PROVIDER_PRIVATE_NETWORK_ALLOWED_HOSTS: "169.254.169.254",
        ROMEO_ENV: "production",
      }),
    });

    await expect(
      providerFetch("https://api.example.com/v1/models"),
    ).rejects.toMatchObject({ reason: "metadata_destination" });
    expect(pinnedFetchImpl).toHaveBeenCalledTimes(1);
  });

  it("blocks loopback in production unless the operator allowlists it", async () => {
    const lookup = async () => [{ address: "127.0.0.1", family: 4 as const }];
    const pinnedFetchImpl = vi.fn(async () => new Response("ok"));
    await expect(
      createProviderEgressFetch({
        hostLookup: lookup,
        pinnedFetchImpl,
        policy: production,
      })("http://localhost:11434/api/tags"),
    ).rejects.toMatchObject({ reason: "private_network_not_allowlisted" });

    const allowlisted = createProviderEgressFetch({
      hostLookup: lookup,
      pinnedFetchImpl,
      policy: providerNetworkPolicyFromEnv({
        PROVIDER_PRIVATE_NETWORK_ALLOWED_HOSTS: "localhost:11434",
        ROMEO_ENV: "production",
      }),
    });
    expect(
      await (await allowlisted("http://localhost:11434/api/tags")).text(),
    ).toBe("ok");
  });

  it("streams provider responses through the pinned socket and honours aborts", async () => {
    let releaseSecondChunk!: () => void;
    const secondChunk = new Promise<void>((resolve) => {
      releaseSecondChunk = resolve;
    });
    let hostHeader: string | undefined;
    const port = await listen(
      createServer(async (request, response) => {
        hostHeader = request.headers.host;
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write("data: one\n\n");
        await secondChunk;
        response.write("data: two\n\n");
        response.end();
      }),
    );
    const providerFetch = createProviderEgressFetch({
      hostLookup: async () => [{ address: "127.0.0.1", family: 4 }],
      policy: development,
    });

    const response = await providerFetch(
      `http://localhost:${port}/v1/chat/completions`,
      { method: "POST", body: JSON.stringify({ stream: true }) },
    );
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    // The first event arrives while the server is still holding the stream open.
    expect(decoder.decode((await reader.read()).value)).toBe("data: one\n\n");
    releaseSecondChunk();
    let rest = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      rest += decoder.decode(value);
    }
    expect(rest).toBe("data: two\n\n");
    expect(hostHeader).toBe(`localhost:${port}`);

    const stalled = await listen(
      createServer((_request, response) => {
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.write("data: partial\n\n");
      }),
    );
    const controller = new AbortController();
    const abortable = await providerFetch(
      `http://localhost:${stalled}/v1/chat/completions`,
      { signal: controller.signal },
    );
    const stalledReader = abortable.body!.getReader();
    await stalledReader.read();
    controller.abort(new Error("provider_timeout"));
    await expect(stalledReader.read()).rejects.toBeDefined();
  });
});

import { describe, expect, it, vi } from "vitest";

import { workerBrokerHttpClient } from "./worker-broker-client";

describe("workerBrokerHttpClient", () => {
  it("uses only the audience credential and binds the worker identity", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (request, init) => {
      expect(String(request)).toBe(
        "https://api.example.test/api/v1/internal/worker-broker/tool_dispatch/claims",
      );
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer tool-broker-secret",
      );
      expect(JSON.parse(String(init?.body))).toEqual({
        leaseSeconds: 300,
        workerId: "tool-worker-7",
      });
      expect(init?.redirect).toBe("error");
      return new Response(
        JSON.stringify({ data: { claimed: false, audience: "tool_dispatch" } }),
      );
    });
    const client = workerBrokerHttpClient(
      {
        baseUrl: "https://api.example.test",
        env: {
          ROMEO_API_KEY: "ordinary-api-key-must-not-be-used",
          ROMEO_WORKER_ID: "tool-worker-7",
          TOOL_DISPATCH_BROKER_TOKEN: "tool-broker-secret",
        },
        fetchImpl,
      },
      "tool_dispatch",
    );
    await expect(client.claim({ leaseSeconds: 300 })).resolves.toEqual({
      claimed: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails closed without the exact audience credential", () => {
    expect(() =>
      workerBrokerHttpClient(
        {
          baseUrl: "https://api.example.test",
          env: { TOOL_DISPATCH_BROKER_TOKEN: "wrong-audience-only" },
          fetchImpl: fetch,
        },
        "browser_automation",
      ),
    ).toThrow(/BROWSER_AUTOMATION_BROKER_TOKEN/);
  });

  it("rejects credential-bearing, plaintext external, and pathful broker URLs", () => {
    for (const baseUrl of [
      "https://user:password@api.example.test",
      "http://api.example.test",
      "https://api.example.test/proxy",
      "https://api.example.test?target=other",
    ]) {
      expect(() =>
        workerBrokerHttpClient(
          {
            baseUrl,
            env: { TOOL_DISPATCH_BROKER_TOKEN: "tool-broker-secret" },
            fetchImpl: fetch,
          },
          "tool_dispatch",
        ),
      ).toThrow(/ROMEO_BASE_URL/);
    }
    expect(() =>
      workerBrokerHttpClient(
        {
          baseUrl: "http://romeo-api.romeo.svc",
          env: {
            ROMEO_WORKER_BROKER_ALLOW_INSECURE_HTTP: "true",
            TOOL_DISPATCH_BROKER_TOKEN: "tool-broker-secret",
          },
          fetchImpl: fetch,
        },
        "tool_dispatch",
      ),
    ).not.toThrow();
  });

  it("caps response streaming before buffering and does not relay server messages", async () => {
    const oversized = workerBrokerHttpClient(
      {
        baseUrl: "https://api.example.test",
        env: { TOOL_DISPATCH_BROKER_TOKEN: "tool-broker-secret" },
        fetchImpl: async () =>
          new Response("", {
            headers: { "content-length": "10000001" },
          }),
      },
      "tool_dispatch",
    );
    await expect(oversized.claim({ leaseSeconds: 300 })).rejects.toThrow(
      "worker_broker_response_too_large",
    );
    const rejected = workerBrokerHttpClient(
      {
        baseUrl: "https://api.example.test",
        env: { TOOL_DISPATCH_BROKER_TOKEN: "tool-broker-secret" },
        fetchImpl: async () =>
          new Response(
            JSON.stringify({ error: { message: "upstream secret detail" } }),
            { status: 403 },
          ),
      },
      "tool_dispatch",
    );
    await expect(rejected.claim({ leaseSeconds: 300 })).rejects.toThrow(
      "worker_broker_http_403",
    );
    await expect(rejected.claim({ leaseSeconds: 300 })).rejects.not.toThrow(
      /upstream secret detail/,
    );
  });
});

import { describe, expect, it, vi } from "vitest";

import { createClient } from "../generated/sdk/client/client.gen";
import { configureGeneratedClient } from "./browser";

describe("generated browser client runtime", () => {
  it("adds request correlation and maps stable API failures", async () => {
    const onUnauthorized = vi.fn();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      expect(input).toBeInstanceOf(Request);
      const request = input as Request;
      expect(request.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/u);
      return new Response(
        JSON.stringify({
          error: {
            code: "unauthorized",
            message: "Authentication is required.",
            request_id: "request_1",
            details: {},
          },
        }),
        {
          status: 401,
          headers: { "content-type": "application/json" },
        },
      );
    });
    const client = createClient({ baseUrl: "https://romeo.example/api/v1" });
    client.setConfig({ fetch: fetchImpl });
    configureGeneratedClient(client, { onUnauthorized });

    await expect(
      client.get({ url: "/health", throwOnError: true }),
    ).rejects.toMatchObject({
      name: "RomeoApiError",
      message: "Authentication is required.",
      status: 401,
      body: { error: { code: "unauthorized", request_id: "request_1" } },
    });
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

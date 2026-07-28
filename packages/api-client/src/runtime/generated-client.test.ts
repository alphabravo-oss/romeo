import { describe, expect, it, vi } from "vitest";

import { dataConnectorsList } from "../generated/sdk";
import { createGeneratedClient } from "./generated-client";

describe("generated client", () => {
  it("preserves the generated SDK response wrapper for envelope consumers", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "connector_1" }] }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
    const client = createGeneratedClient({
      baseUrl: "https://romeo.example",
      fetchImpl,
    });

    const response = await dataConnectorsList({
      client,
      throwOnError: true,
    });

    expect(response.data).toEqual({
      data: [{ id: "connector_1" }],
    });
    expect(response.response.status).toBe(200);
  });
});

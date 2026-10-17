import { describe, expect, it, vi } from "vitest";

import { toolConnectorsList } from "../generated/sdk";
import { createGeneratedClient } from "./generated-client";

describe("generated client", () => {
  it("preserves the generated SDK response wrapper for envelope consumers", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "tool_connector_1" }] }), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
    const client = createGeneratedClient({
      baseUrl: "https://romeo.example",
      fetchImpl,
    });

    const response = await toolConnectorsList({
      client,
      throwOnError: true,
    });

    expect(response.data).toEqual({
      data: [{ id: "tool_connector_1" }],
    });
    expect(response.response.status).toBe(200);
  });
});

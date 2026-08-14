import { afterEach, describe, expect, it, vi } from "vitest";

import { createRequestApiClient } from "./router-api-client";

describe("request-scoped generated API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("forwards only the current request's approved identity headers", async () => {
    const received: Headers[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        received.push(
          new Headers(input instanceof Request ? input.headers : {}),
        );
        return Promise.resolve(
          new Response(JSON.stringify({ data: [] }), {
            headers: { "content-type": "application/json" },
            status: 200,
          }),
        );
      }),
    );
    const first = createRequestApiClient(
      new Request("https://romeo.example/workspace", {
        headers: {
          cookie: "session=first",
          "x-not-forwarded": "private-proxy-value",
        },
      }),
    );
    const second = createRequestApiClient(
      new Request("https://romeo.example/admin", {
        headers: { cookie: "session=second" },
      }),
    );

    await Promise.all([
      first.get({ url: "/providers" }),
      second.get({ url: "/providers" }),
    ]);

    expect(received.map((headers) => headers.get("cookie"))).toEqual([
      "session=first",
      "session=second",
    ]);
    expect(received.every((headers) => !headers.has("x-not-forwarded"))).toBe(
      true,
    );
  });
});

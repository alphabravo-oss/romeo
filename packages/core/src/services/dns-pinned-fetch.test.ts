import { createServer } from "node:http";

import { describe, expect, it } from "vitest";

import { dnsPinnedFetch } from "./dns-pinned-fetch";

describe("DNS-pinned fetch", () => {
  it("connects only through the approved address while preserving the original host", async () => {
    let observedHost = "";
    const server = createServer((request, response) => {
      observedHost = request.headers.host ?? "";
      response.setHeader("content-type", "text/plain");
      response.end("pinned response");
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });
    try {
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("Test server did not expose a TCP port.");
      }
      const response = await dnsPinnedFetch(
        new URL(`http://rebinding.example.invalid:${address.port}/document`),
        { headers: { accept: "text/plain" } },
        [{ address: "127.0.0.1", family: 4 }],
      );

      expect(await response.text()).toBe("pinned response");
      expect(observedHost).toBe(`rebinding.example.invalid:${address.port}`);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

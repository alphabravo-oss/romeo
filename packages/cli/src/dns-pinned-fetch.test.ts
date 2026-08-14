import { createServer } from "node:http";

import { describe, expect, it } from "vitest";

import { dnsPinnedFetch } from "./dns-pinned-fetch";

describe("tool dispatch DNS-pinned fetch", () => {
  it("uses only an approved socket address while preserving Host", async () => {
    let observedHost = "";
    const server = createServer((request, response) => {
      observedHost = request.headers.host ?? "";
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
        new URL(`http://rebinding.example.invalid:${address.port}/resource`),
        { headers: { accept: "text/plain" } },
        [{ address: "127.0.0.1", family: 4 }],
      );

      expect(await response.text()).toBe("pinned response");
      expect(observedHost).toBe(`rebinding.example.invalid:${address.port}`);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("refuses to connect when no address was approved", async () => {
    // The empty case must throw, never fall through to an unpinned request.
    await expect(
      dnsPinnedFetch(new URL("http://example.invalid/resource"), {}, []),
    ).rejects.toThrow(TypeError);
  });

  it("fails the lookup rather than resolving when no approved family matches", async () => {
    // The socket asked for IPv6 and policy only approved IPv4. Falling back to
    // real DNS here would defeat pinning outright, so the lookup must error.
    await expect(
      dnsPinnedFetch(
        new URL("http://example.invalid/resource"),
        { headers: { accept: "text/plain" } },
        [{ address: "::1", family: 6 }],
      ),
    ).rejects.toThrow();
  });
});

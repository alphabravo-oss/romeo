import { MemoryObjectStore } from "@romeo/storage";
import { describe, expect, it, vi } from "vitest";

import { createRomeoApi } from "../api";
import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { testEnv } from "../test-support/env";

function apiWithObjectReadiness(ready: boolean) {
  const objectStore = Object.assign(new MemoryObjectStore(), {
    async checkReadiness() {
      return {
        authenticated: true,
        deleteVerified: ready,
        encryptionConfigured: true,
        lifecycleConfigured: true,
        readAfterWriteVerified: ready,
        ready,
        replicationConfigured: false,
        tlsEnabled: true,
        versioningEnabled: true,
        writeVerified: ready,
      };
    },
  });
  return createRomeoApi(new InMemoryRomeoRepository(), {
    env: testEnv({ OBJECT_STORE_DRIVER: "s3" }),
    objectStore,
  });
}

describe("internal dependency readiness", () => {
  it("returns a bounded generic report only when every dependency passes", async () => {
    const ready = await apiWithObjectReadiness(true).request(
      "/api/v1/readyz",
      undefined,
      { requestPeerAddress: "127.0.0.1" },
    );
    const unavailable = await apiWithObjectReadiness(false).request(
      "/api/v1/readyz",
      undefined,
      { requestPeerAddress: "::1" },
    );

    expect(ready.status).toBe(200);
    expect(unavailable.status).toBe(503);
    const readyBody = await ready.json();
    const unavailableBody = await unavailable.json();
    expect(readyBody).toMatchObject({ data: { status: "ready" } });
    expect(unavailableBody).toMatchObject({ data: { status: "unready" } });
    expect(JSON.stringify(unavailableBody)).not.toContain("bucket");
    expect(JSON.stringify(unavailableBody)).not.toContain("secret");
  });

  it("hides the internal probe from non-loopback transport peers", async () => {
    const response = await apiWithObjectReadiness(true).request(
      "/api/v1/readyz",
      undefined,
      { requestPeerAddress: "10.42.1.5" },
    );
    expect(response.status).toBe(404);
  });

  it("single-flights an HTTP probe burst through the process-owned readiness service", async () => {
    let checks = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const objectStore = Object.assign(new MemoryObjectStore(), {
      async checkReadiness() {
        checks += 1;
        await gate;
        return {
          authenticated: true,
          deleteVerified: true,
          encryptionConfigured: true,
          lifecycleConfigured: true,
          readAfterWriteVerified: true,
          ready: true,
          replicationConfigured: false,
          tlsEnabled: true,
          versioningEnabled: true,
          writeVerified: true,
        };
      },
    });
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: testEnv({ OBJECT_STORE_DRIVER: "s3" }),
      objectStore,
    });
    const requests = Array.from({ length: 32 }, () =>
      api.request("/api/v1/readyz", undefined, {
        requestPeerAddress: "127.0.0.1",
      }),
    );
    await vi.waitFor(() => expect(checks).toBe(1));
    release?.();

    const responses = await Promise.all(requests);
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(checks).toBe(1);
  });
});

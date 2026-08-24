import { describe, expect, it } from "vitest";

import { createRomeoApi } from "./api";
import type { RomeoRepository } from "./domain/repository";
import type { RepositoryRequestScope } from "./domain/repository-request-scope";
import {
  InMemoryRomeoRepository,
  createRuntimeSeedData,
} from "./repositories/in-memory";
import { testEnv } from "./test-support/env";

const toolCredential = "Tool-Broker!4hQ8wZ2mN7cR5tY9pL6dF3kS";

describe("worker broker API boundary", () => {
  it("authenticates only the exact broker route and does not grant general API access", async () => {
    const repository = new InMemoryRomeoRepository(createRuntimeSeedData());
    const scopes: string[] = [];
    const app = createRomeoApi(repository, {
      env: testEnv({ TOOL_DISPATCH_BROKER_TOKEN: toolCredential }),
      repositoryRequestScope: trackingScope(repository, scopes),
    });
    const claim = await app.request(
      "/api/v1/internal/worker-broker/tool_dispatch/claims",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${toolCredential}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ leaseSeconds: 60, workerId: "worker-a" }),
      },
    );
    expect(claim.status).toBe(200);
    await expect(claim.json()).resolves.toMatchObject({
      data: { audience: "tool_dispatch", claimed: false },
    });
    expect(scopes).toContain("tenant:org_default");

    const general = await app.request("/api/v1/jobs", {
      headers: { authorization: `Bearer ${toolCredential}` },
    });
    expect(general.status).toBe(401);
    await expect(general.json()).resolves.toMatchObject({
      error: { code: "unauthorized" },
    });
    const spoofedPath = await app.request(
      "/api/v1/internal/worker-broker/tool_dispatch/claims/extra",
      {
        method: "POST",
        headers: { authorization: `Bearer ${toolCredential}` },
      },
    );
    expect(spoofedPath.status).toBe(401);
  });

  it("denies missing, wrong-audience, malformed, and spoofed worker inputs", async () => {
    const repository = new InMemoryRomeoRepository(createRuntimeSeedData());
    const app = createRomeoApi(repository, {
      env: testEnv({ TOOL_DISPATCH_BROKER_TOKEN: toolCredential }),
      repositoryRequestScope: trackingScope(repository, []),
    });
    for (const authorization of [undefined, "Bearer wrong-audience-secret"]) {
      const response = await app.request(
        "/api/v1/internal/worker-broker/tool_dispatch/claims",
        {
          method: "POST",
          headers: {
            ...(authorization === undefined ? {} : { authorization }),
            "content-type": "application/json",
          },
          body: JSON.stringify({ leaseSeconds: 60, workerId: "worker-a" }),
        },
      );
      expect(response.status).toBe(401);
    }
    const wrongAudience = await app.request(
      "/api/v1/internal/worker-broker/browser_automation/claims",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${toolCredential}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ leaseSeconds: 60, workerId: "worker-a" }),
      },
    );
    expect(wrongAudience.status).toBe(404);
    const malformedWorker = await app.request(
      "/api/v1/internal/worker-broker/tool_dispatch/claims",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${toolCredential}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ leaseSeconds: 60, workerId: "../../spoof" }),
      },
    );
    expect(malformedWorker.status).toBe(400);
  });
});

function trackingScope(
  repository: RomeoRepository,
  calls: string[],
): RepositoryRequestScope {
  return {
    runAsSystem: async (work) => {
      calls.push("system");
      return work(repository);
    },
    runAsTenant: async (orgId, work) => {
      calls.push(`tenant:${orgId}`);
      return work(repository);
    },
  };
}

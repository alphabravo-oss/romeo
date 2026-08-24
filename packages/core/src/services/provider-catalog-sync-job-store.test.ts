import { describe, expect, it, vi } from "vitest";

import type { AuthSubject } from "@romeo/auth";
import { defaultProviderCapabilities } from "@romeo/providers";

import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { ProviderCatalogSyncJobStore } from "./provider-catalog-sync-job-store";

const subject: AuthSubject = {
  groupIds: ["group_admins"],
  id: "user_catalog_admin",
  isAdmin: true,
  orgId: "org_default",
  scopes: ["models:read", "providers:read", "providers:write"],
  type: "user",
  workspaceIds: ["workspace_default"],
};

describe("provider catalog sync durable jobs", () => {
  it("atomically leases one queued job across concurrent workers", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createProvider({
      baseUrl: "https://models.example.test/v1",
      capabilities: defaultProviderCapabilities("openai-compatible"),
      catalogSync: { modelCount: 1_000, status: "ready" },
      enabled: true,
      id: "provider_large_catalog",
      name: "Large catalog",
      orgId: subject.orgId,
      type: "openai-compatible",
    });
    const sync = vi.fn(async () => ({ length: 12 }));
    const store = new ProviderCatalogSyncJobStore(repository, sync);
    const started = await store.start({
      mode: "async_job",
      providerId: "provider_large_catalog",
      subject,
    });
    expect(started.mode).toBe("async_job");
    if (started.mode !== "async_job") throw new Error("Expected async job");

    const outcomes = await Promise.all([
      store.runNext({ subject, workerId: "worker_a" }),
      store.runNext({ subject, workerId: "worker_b" }),
    ]);

    expect(sync).toHaveBeenCalledTimes(1);
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    await expect(
      store.get({
        jobId: started.job.jobId,
        providerId: "provider_large_catalog",
        subject,
      }),
    ).resolves.toMatchObject({ modelCount: 12, percent: 100, state: "ready" });
  });

  it("binds reads to both provider and job identifiers", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createProvider({
      baseUrl: "https://models.example.test/v1",
      capabilities: defaultProviderCapabilities("openai-compatible"),
      enabled: true,
      id: "provider_bound_catalog",
      name: "Bound catalog",
      orgId: subject.orgId,
      type: "openai-compatible",
    });
    const store = new ProviderCatalogSyncJobStore(repository, async () => ({
      length: 0,
    }));
    const started = await store.start({
      mode: "async_job",
      providerId: "provider_bound_catalog",
      subject,
    });
    if (started.mode !== "async_job") throw new Error("Expected async job");

    await expect(
      store.get({
        jobId: started.job.jobId,
        providerId: "provider_other",
        subject,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

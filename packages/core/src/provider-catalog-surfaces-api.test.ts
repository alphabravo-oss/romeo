import { describe, expect, it } from "vitest";

import { createRomeoApi } from "./api";
import { InMemoryRomeoRepository } from "./repositories/in-memory";
import { PROVIDER_CATALOG_INLINE_CEILING } from "./services/provider-catalog-sync-job";
import { testEnv } from "./test-support/env";

describe("provider catalog surfaces HTTP", () => {
  it("rejects raw secrets on create and persists dialect extras without leaking them", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: testEnv(),
      startBackgroundWorkers: false,
    });
    const denied = await api.request("/api/v1/providers", {
      body: JSON.stringify({
        baseUrl: "https://api.anthropic.com",
        credentialRef: "sk-live-secret",
        name: "Bad Anthropic",
        type: "anthropic",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(denied.status).toBe(400);
    expect(await denied.json()).toMatchObject({
      error: {
        code: "invalid_request",
        details: { code: "provider_raw_secret_forbidden" },
      },
    });

    const created = await api.request("/api/v1/providers", {
      body: JSON.stringify({
        auth: "api_key",
        baseUrl: "https://api.anthropic.com",
        credentialRef: "romeo-secret://org/anthropic-key",
        name: "Anthropic",
        region: "us-east-1",
        target: "anthropic",
        type: "anthropic",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(created.status).toBe(201);
    const body = await created.json();
    expect(body.data).toMatchObject({
      auth: "api_key",
      name: "Anthropic",
      region: "us-east-1",
      target: "anthropic",
    });
    expect(JSON.stringify(body)).not.toMatch(/sk-|romeo-secret:\/\//u);
  });

  it("turns large-catalog sync into an idempotent observable job", async () => {
    const repository = new InMemoryRomeoRepository();
    const api = createRomeoApi(repository, {
      env: testEnv(),
      startBackgroundWorkers: false,
    });
    const created = await api.request("/api/v1/providers", {
      body: JSON.stringify({
        baseUrl: "https://gateway.example/v1",
        name: "Large catalog",
        type: "openai-compatible",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(created.status).toBe(201);
    const providerId = (await created.json()).data.id as string;
    const current = await repository.getProvider(providerId);
    expect(current).toBeDefined();
    await repository.updateProvider({
      ...current!,
      catalogSync: {
        modelCount: PROVIDER_CATALOG_INLINE_CEILING + 1,
        status: "ready",
      },
    });

    const inline = await api.request(
      `/api/v1/providers/${providerId}/sync?mode=inline`,
      { method: "POST" },
    );
    expect(inline.status).toBe(400);
    expect(await inline.json()).toMatchObject({
      error: {
        code: "invalid_request",
        details: { code: "provider_catalog_sync_must_be_async" },
      },
    });

    const first = await api.request(
      `/api/v1/providers/${providerId}/sync?mode=async_job`,
      { method: "POST" },
    );
    expect(first.status).toBe(202);
    const firstJob = (await first.json()).data;
    expect(firstJob).toMatchObject({
      percent: 0,
      providerId,
      state: "queued",
    });

    const replay = await api.request(
      `/api/v1/providers/${providerId}/sync?mode=async_job`,
      { method: "POST" },
    );
    expect(replay.status).toBe(202);
    expect((await replay.json()).data.jobId).toBe(firstJob.jobId);

    const ran = await api.request(
      `/api/v1/providers/${providerId}/sync-jobs/${firstJob.jobId}/run`,
      { method: "POST" },
    );
    expect(ran.status).toBe(200);
    const ready = (await ran.json()).data;
    expect(ready.state === "ready" || ready.state === "failed").toBe(true);

    const fetched = await api.request(
      `/api/v1/providers/${providerId}/sync-jobs/${firstJob.jobId}`,
    );
    expect(fetched.status).toBe(200);
    expect((await fetched.json()).data.jobId).toBe(firstJob.jobId);
  });

  it("persists probe freshness and names the exact unavailable constraint", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: testEnv(),
      startBackgroundWorkers: false,
    });
    const probe = await api.request(
      "/api/v1/models/model_openai_compatible_default/probe",
      {
        body: JSON.stringify({ features: ["streaming", "tools"] }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    expect(probe.status).toBe(200);
    const probedAt = (await probe.json()).data.probedAt as string;
    expect(probedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);

    const models = await api.request("/api/v1/models");
    expect(models.status).toBe(200);
    const catalog = (await models.json()).data as Array<{
      catalogSurface?: { probeFreshness: string; tools: string };
      id: string;
      probedAt?: string;
    }>;
    const model = catalog.find(
      (item) => item.id === "model_openai_compatible_default",
    );
    expect(model?.probedAt).toBe(probedAt);
    expect(model?.catalogSurface?.probeFreshness).toBe("fresh");

    const preview = await api.request("/api/v1/models/compatibility/preview", {
      body: JSON.stringify({
        modelId: "model_openai_compatible_default",
        required: {
          attachments: false,
          imageOutput: true,
          localOnly: false,
          reasoning: false,
          tools: false,
        },
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(preview.status).toBe(200);
    expect((await preview.json()).data).toMatchObject({
      constraint: "image_output_unsupported",
      outcome: "unavailable",
    });
  });
});

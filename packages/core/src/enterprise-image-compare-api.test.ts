import { describe, expect, it } from "vitest";

import { createRomeoApi } from "./api";
import { InMemoryRomeoRepository } from "./repositories/in-memory";
import { testEnv } from "./test-support/env";

describe("image job and compare HTTP", () => {
  it("uses real file readiness for image jobs and only cancels a stored job", async () => {
    const repository = new InMemoryRomeoRepository();
    const api = createRomeoApi(repository, { env: testEnv() });
    const ready = await repository.createFileObject({
      id: "file_image_ready",
      orgId: "org_default",
      workspaceId: "workspace_default",
      ownerType: "user",
      ownerId: "user_dev_admin",
      fileName: "ready.png",
      mimeType: "image/png",
      sizeBytes: 8,
      sha256: "a".repeat(64),
      objectKey: "files/ready.png",
      purpose: "general",
      status: "ready",
      lifecycleVersion: 1,
      metadata: {},
      createdAt: "2026-08-14T12:00:00.000Z",
      updatedAt: "2026-08-14T12:00:00.000Z",
    });
    await repository.createFileObject({
      id: "file_image_uploading",
      orgId: "org_default",
      workspaceId: "workspace_default",
      ownerType: "user",
      ownerId: "user_dev_admin",
      fileName: "pending.png",
      mimeType: "image/png",
      sizeBytes: 8,
      sha256: "b".repeat(64),
      objectKey: "files/pending.png",
      purpose: "general",
      status: "uploading",
      lifecycleVersion: 1,
      metadata: {},
      createdAt: "2026-08-14T12:00:00.000Z",
      updatedAt: "2026-08-14T12:00:00.000Z",
    });

    const generate = await api.request("/api/v1/images/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        kind: "generate",
      }),
    });
    expect(generate.status).toBe(200);
    const generateBody = await generate.json();
    expect(generateBody.data.outcome).toBe("accepted");
    const jobId = generateBody.data.jobId as string;
    expect(jobId).toMatch(/^image_job_/);

    const unready = await api.request("/api/v1/images/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        kind: "generate",
        sourceFileId: "file_image_uploading",
      }),
    });
    expect(await unready.json()).toMatchObject({
      data: { outcome: "denied", code: "file_not_ready" },
    });

    const readyJob = await api.request("/api/v1/images/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        kind: "generate",
        sourceFileId: ready.id,
      }),
    });
    expect((await readyJob.json()).data.outcome).toBe("accepted");

    const missing = await api.request(
      "/api/v1/images/jobs/image_job_missing/cancel",
      { method: "POST" },
    );
    expect(missing.status).toBe(404);

    const cancelled = await api.request(`/api/v1/images/jobs/${jobId}/cancel`, {
      method: "POST",
    });
    expect(await cancelled.json()).toMatchObject({
      data: { outcome: "accepted", state: "cancelled" },
    });
  });

  it("probes a model and previews turn compatibility", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: testEnv(),
    });
    const probe = await api.request(
      "/api/v1/models/model_openai_compatible_default/probe",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ features: ["streaming", "tools"] }),
      },
    );
    expect(probe.status).toBe(200);
    const probeBody = await probe.json();
    expect(probeBody.data.modelId).toBe("model_openai_compatible_default");
    expect(probeBody.data.results[0].outcome).toBe("match");

    const preview = await api.request("/api/v1/models/compatibility/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        modelId: "model_openai_compatible_default",
        required: {
          attachments: false,
          tools: true,
          reasoning: false,
          imageOutput: false,
          localOnly: false,
        },
      }),
    });
    expect(preview.status).toBe(200);
    expect((await preview.json()).data.outcome).toBeDefined();
  });
});

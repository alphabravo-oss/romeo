import { seededSubject } from "@romeo/auth";
import { MemoryObjectStore } from "@romeo/storage";
import { describe, expect, it } from "vitest";

import { createRomeoApi } from "./api";
import { InMemoryRomeoRepository } from "./repositories/in-memory";
import { IdempotencyService } from "./services/idempotency-service";

describe("durable command idempotency", () => {
  it("replays exact results, conflicts on shape drift, and never persists raw keys or bodies", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = new IdempotencyService(repository);
    let calls = 0;
    const input = {
      subject: seededSubject,
      operation: "images.generate" as const,
      key: "RAW_KEY_SENTINEL",
      request: { prompt: "RAW_BODY_SENTINEL", count: 1 },
      responseStatus: 201,
      work: async () => ({ artifactId: `artifact_${++calls}` }),
    };
    const first = await service.execute(input);
    const replay = await service.execute({
      ...input,
      request: { count: 1, prompt: "RAW_BODY_SENTINEL" },
    });
    expect(first.value).toEqual({ artifactId: "artifact_1" });
    expect(replay).toMatchObject({
      value: first.value,
      idempotency: { replayed: true },
    });
    expect(calls).toBe(1);
    await expect(
      service.execute({ ...input, request: { prompt: "different", count: 1 } }),
    ).rejects.toMatchObject({ code: "idempotency_key_conflict", status: 409 });
    const serialized = JSON.stringify(
      (repository as unknown as { data: unknown }).data,
    );
    expect(serialized).not.toContain("RAW_KEY_SENTINEL");
    expect(serialized).not.toContain("RAW_BODY_SENTINEL");
  });

  it("gives one concurrent owner and allows an expired lease takeover", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = new IdempotencyService(repository, { leaseMs: 60_000 });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = service.execute({
      subject: seededSubject,
      operation: "runs.start",
      key: "concurrent",
      request: { chatId: "chat_welcome" },
      responseStatus: 202,
      work: async () => {
        await gate;
        return { runId: "run_one" };
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(
      service.execute({
        subject: seededSubject,
        operation: "runs.start",
        key: "concurrent",
        request: { chatId: "chat_welcome" },
        responseStatus: 202,
        work: async () => ({ runId: "run_two" }),
      }),
    ).rejects.toMatchObject({ code: "idempotency_request_in_progress" });
    release();
    await expect(first).resolves.toMatchObject({ value: { runId: "run_one" } });

    const expired = receipt({
      id: "receipt_expired",
      keyHash: "a".repeat(64),
      requestHash: "b".repeat(64),
      leaseToken: "old",
      leaseExpiresAt: "2026-08-14T09:00:00.000Z",
    });
    expect(
      await repository.claimIdempotencyReceipt({
        receipt: expired,
        now: "2026-08-14T10:00:00.000Z",
      }),
    ).toMatchObject({ outcome: "owner" });
    const takeover = await repository.claimIdempotencyReceipt({
      receipt: {
        ...expired,
        id: "receipt_takeover_candidate",
        leaseToken: "new",
        leaseExpiresAt: "2026-08-14T11:00:00.000Z",
      },
      now: "2026-08-14T10:00:00.000Z",
    });
    expect(takeover).toMatchObject({
      outcome: "owner",
      receipt: { id: "receipt_expired", leaseToken: "new" },
    });

    await repository.claimIdempotencyReceipt({
      receipt: receipt({
        id: "receipt_active_past_ttl",
        keyHash: "f".repeat(64),
        requestHash: "0".repeat(64),
        leaseExpiresAt: "2026-08-14T11:00:00.000Z",
        expiresAt: "2026-08-14T09:00:00.000Z", // deliberately-expired: cleanup guard
      }),
      now: "2026-08-14T10:00:00.000Z",
    });
    expect(
      await repository.deleteExpiredIdempotencyReceipts({
        before: "2026-08-14T10:30:00.000Z",
        limit: 10,
      }),
    ).toBe(0);
    expect(
      await repository.deleteExpiredIdempotencyReceipts({
        before: "2026-08-14T12:00:00.000Z",
        limit: 10,
      }),
    ).toBe(1);
  });

  it("keeps failures terminal, cleans expired receipts in bounds, and purges tenants", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = new IdempotencyService(repository);
    await expect(
      service.execute({
        subject: seededSubject,
        operation: "runs.start",
        key: "terminal-failure",
        request: { chatId: "chat_welcome" },
        responseStatus: 202,
        work: async () => {
          throw new Error("RAW_FAILURE_SENTINEL");
        },
      }),
    ).rejects.toThrow("RAW_FAILURE_SENTINEL");
    await expect(
      service.execute({
        subject: seededSubject,
        operation: "runs.start",
        key: "terminal-failure",
        request: { chatId: "chat_welcome" },
        responseStatus: 202,
        work: async () => ({ runId: "must_not_run" }),
      }),
    ).rejects.toMatchObject({ code: "idempotency_request_failed" });
    expect(
      JSON.stringify((repository as unknown as { data: unknown }).data),
    ).not.toContain("RAW_FAILURE_SENTINEL");
    expect(
      await repository.deleteExpiredIdempotencyReceipts({
        before: "2100-01-01T00:00:00.000Z",
        limit: 1,
      }),
    ).toBe(1);
    await repository.claimIdempotencyReceipt({
      receipt: receipt({ id: "receipt_for_purge" }),
      now: "2026-08-14T10:00:00.000Z",
    });
    await repository.createRun({
      id: "run_summary_tenant_purge",
      orgId: "org_default",
      workspaceId: "workspace_default",
      chatId: "chat_welcome",
      agentId: "agent_default",
      agentVersionId: "agent_version_default_v1",
      modelId: "model_openai_compatible_default",
      providerId: "provider_openai_compatible",
      status: "completed",
      createdBy: seededSubject.id,
      createdAt: "2026-08-14T10:00:00.000Z",
      completedAt: "2026-08-14T10:00:01.000Z",
    });
    await repository.appendRunEvents([
      {
        id: "evt_summary_tenant_purge",
        runId: "run_summary_tenant_purge",
        sequence: 1,
        schemaVersion: 1,
        type: "reasoning.summary.delta",
        data: {
          classification: "provider_safe_summary",
          contentPolicyApplied: true,
          text: "tenant-purge-summary-sentinel",
        },
        createdAt: "2026-08-14T10:00:00.500Z",
      },
    ]);
    const purge = await repository.purgeTenantData("org_default");
    expect(purge.recordCounts.idempotencyReceipts).toBe(1);
    expect(purge.recordCounts.runEvents).toBe(1);
    expect(await repository.listRunEvents("run_summary_tenant_purge")).toEqual(
      [],
    );
  });

  it("deduplicates image and run HTTP side effects and harmonizes body/header keys", async () => {
    const repository = new InMemoryRomeoRepository();
    const model = (await repository.getModel(
      "model_openai_compatible_default",
    ))!;
    await repository.updateModel({
      ...model,
      capabilities: { ...model.capabilities, imageGeneration: true },
      capabilitiesSource: "override",
    });
    let providerCalls = 0;
    let providerIdempotencyHeader: string | null = null;
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlJkAAAAASUVORK5CYII=";
    const api = createRomeoApi(repository, {
      objectStore: new MemoryObjectStore(),
      providerFetch: async (_url, init) => {
        providerCalls += 1;
        providerIdempotencyHeader = new Headers(init?.headers).get(
          "Idempotency-Key",
        );
        return Response.json({ data: [{ b64_json: png }] });
      },
    });
    const imageBody = {
      workspaceId: "workspace_default",
      modelId: model.id,
      prompt: "one governed image",
      count: 1,
      size: "1024x1024",
      idempotencyKey: "image-command-1",
    };
    const firstImage = await api.request("/api/v1/images/generations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "image-command-1",
      },
      body: JSON.stringify(imageBody),
    });
    const replayImage = await api.request("/api/v1/images/generations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(imageBody),
    });
    expect([firstImage.status, replayImage.status]).toEqual([201, 201]);
    expect(firstImage.headers.get("Idempotency-Replayed")).toBe("false");
    expect(firstImage.headers.get("Idempotency-Receipt-Expires-At")).toMatch(
      /^\d{4}-\d{2}-\d{2}T/u,
    );
    expect(replayImage.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await replayImage.clone().json()).toEqual(
      await firstImage.clone().json(),
    );
    expect(providerCalls).toBe(1);
    expect(providerIdempotencyHeader).toMatch(/^idempotency_receipt_/u);
    expect(providerIdempotencyHeader).not.toBe("image-command-1");
    expect(await repository.listFileObjects("org_default")).toHaveLength(1);
    const mismatch = await api.request("/api/v1/images/generations", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "different-header-key",
      },
      body: JSON.stringify(imageBody),
    });
    expect(mismatch.status).toBe(400);
    expect((await mismatch.json()).error.code).toBe("idempotency_key_mismatch");

    const runBody = {
      chatId: "chat_welcome",
      agentId: "agent_default",
      content: "idempotent run prompt",
      idempotencyKey: "run-command-1",
    };
    const firstRun = await api.request("/api/v1/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(runBody),
    });
    const replayRun = await api.request("/api/v1/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(runBody),
    });
    expect([firstRun.status, replayRun.status]).toEqual([202, 202]);
    expect(replayRun.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await repository.listRuns("chat_welcome")).toHaveLength(1);
    expect(
      (await repository.listMessages("chat_welcome")).filter(
        (message) => message.content === "idempotent run prompt",
      ),
    ).toHaveLength(1);
  });
});

function receipt(
  overrides: Partial<
    Parameters<InMemoryRomeoRepository["claimIdempotencyReceipt"]>[0]["receipt"]
  > = {},
): Parameters<
  InMemoryRomeoRepository["claimIdempotencyReceipt"]
>[0]["receipt"] {
  return {
    id: "receipt_default",
    orgId: "org_default",
    actorType: "user",
    actorId: "user_dev_admin",
    credentialHash: "c".repeat(64),
    operation: "runs.start",
    keyHash: "d".repeat(64),
    requestHash: "e".repeat(64),
    state: "in_progress",
    leaseToken: "lease",
    leaseExpiresAt: "2026-08-14T10:30:00.000Z",
    createdAt: "2026-08-14T10:00:00.000Z",
    updatedAt: "2026-08-14T10:00:00.000Z",
    expiresAt: "2026-08-15T10:00:00.000Z",
    ...overrides,
  };
}

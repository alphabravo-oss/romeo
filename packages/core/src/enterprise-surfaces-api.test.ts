import { describe, expect, it } from "vitest";

import { createRomeoApi } from "./api";
import { InMemoryRomeoRepository } from "./repositories/in-memory";
import { testEnv } from "./test-support/env";

describe("enterprise capability surfaces", () => {
  it("fails closed for uninstalled realtime, compute, and compare", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const realtime = await api.request("/api/v1/realtime/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        retention: "none",
        durationSeconds: 30,
      }),
    });
    const compute = await api.request("/api/v1/compute/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        imageDigest: "sha256:0123456789abcdef",
      }),
    });
    const compare = await api.request("/api/v1/run-groups", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        modelIds: ["model_a", "model_b"],
        maxAggregateMicroUsd: 1000,
      }),
    });
    expect(realtime.status).toBe(200);
    expect(await realtime.json()).toMatchObject({
      data: {
        outcome: "denied",
        fallback: "batch_stt_tts",
      },
    });
    expect(compute.status).toBe(200);
    expect(await compute.json()).toMatchObject({
      data: { outcome: "denied" },
    });
    expect(compare.status).toBe(200);
    expect(await compare.json()).toMatchObject({
      data: { outcome: "denied" },
    });
    const replay = await api.request("/api/v1/compute/jobs", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "compute-replay-key",
      },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        imageDigest: "sha256:0123456789abcdef",
      }),
    });
    const replayed = await api.request("/api/v1/compute/jobs", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "compute-replay-key",
      },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        imageDigest: "sha256:0123456789abcdef",
      }),
    });
    expect(replay.status).toBe(200);
    expect(replayed.status).toBe(200);
    expect(await replayed.json()).toEqual(await replay.json());
    const trust = await api.request("/api/v1/admin/trust/posture");
    expect(trust.status).toBe(200);
    expect(await trust.json()).toMatchObject({
      data: { syntheticGreen: false, keys: "not_configured" },
    });
  });

  it("blocks split-chunk firewall output before any persist bytes are released", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const response = await api.request(
      "/api/v1/admin/content-policy/output-buffer/evaluate",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "rolling",
          chunks: ["078-", "05-1120"],
        }),
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        action: "block",
        code: "firewall_output_blocked",
        releasedCharacters: 0,
      },
    });
  });

  it("previews remaining realtime, synthesis, ACL freshness, and crypto-shred contracts", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: testEnv(),
    });
    const adapter = await api.request("/api/v1/realtime/adapters/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nativeAvailable: false, pipelineAvailable: true }),
    });
    expect(adapter.status).toBe(200);
    expect(await adapter.json()).toMatchObject({
      data: { outcome: "accepted", adapter: "pipeline" },
    });
    const synthesis = await api.request("/api/v1/run-groups/synthesis/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        candidateIds: ["c1"],
        candidateHashes: ["h1"],
        providerAuthorized: false,
      }),
    });
    expect((await synthesis.json()).data.outcome).toBe("denied");
    const freshness = await api.request("/api/v1/knowledge/acl/freshness", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sensitivity: "restricted",
        ageMs: 10,
        maxStalenessMs: 1,
      }),
    });
    expect(await freshness.json()).toMatchObject({
      data: { outcome: "stale", failClosed: true, code: "knowledge_acl_stale" },
    });
    const shred = await api.request("/api/v1/admin/trust/crypto/shred", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        legalHold: false,
        backupChecked: true,
        approverIds: ["user_reviewer"],
      }),
    });
    expect(await shred.json()).toMatchObject({
      data: { outcome: "accepted", externalCopiesClaimed: false },
    });

    const segment = await api.request("/api/v1/admin/trust/audit-segments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        eventIds: ["audit_1", "audit_2"],
        signingKeyVersion: "audit-signing.v1",
      }),
    });
    expect(segment.status).toBe(200);
    const sealed = await segment.json();
    expect(sealed.data.outcome).toBe("accepted");
    expect(typeof sealed.data.segmentHash).toBe("string");

    const siem = await api.request("/api/v1/admin/trust/siem-export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        attempt: 0,
        destination: "worm_compatible",
        sealedAt: "2026-08-14T12:00:00.000Z",
        segmentHash: sealed.data.segmentHash,
      }),
    });
    expect(await siem.json()).toMatchObject({
      data: { destination: "worm_compatible", state: "in_flight" },
    });

    const deniedGlass = await api.request("/api/v1/admin/trust/break-glass", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        approverId: "user_reviewer",
        reason: "Sealed legal hold investigation",
        requestedControls: ["tenant_encryption"],
        ttlMinutes: 30,
      }),
    });
    expect(await deniedGlass.json()).toMatchObject({
      data: { code: "break_glass_mandatory_control", outcome: "denied" },
    });
  });
});

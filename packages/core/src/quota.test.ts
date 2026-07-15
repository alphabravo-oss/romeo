import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { readEnv } from "@romeo/config";

import { createRomeoApi } from "./api";
import { InMemoryRomeoRepository } from "./repositories/in-memory";
import type { QuotaCoordinator } from "./services/quota-coordination";

describe("Romeo quota controls", () => {
  it("creates and lists quota buckets without storing duplicates", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const createResponse = await createQuota(api, "tool.call", 2);
    const created = await createResponse.json();

    const duplicateResponse = await createQuota(api, "tool.call", 3);
    const duplicate = await duplicateResponse.json();

    const listResponse = await api.request("/api/v1/quotas");
    const listed = await listResponse.json();

    expect(createResponse.status).toBe(201);
    expect(created.data.scopeType).toBe("org");
    expect(created.data.scopeId).toBe("org_default");
    expect(created.data.used).toBe(0);
    expect(created.data.resetInterval).toBe("none");
    expect(duplicateResponse.status).toBe(409);
    expect(duplicate.error.code).toBe("quota_already_exists");
    expect(listed.data).toHaveLength(1);
  });

  it("reports disabled distributed quota coordination by default", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());

    const response = await api.request("/api/v1/quotas/distributed-status");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      driver: "disabled",
      enabled: false,
      configured: false,
      healthy: null,
      keyPrefix: "romeo:quota:v1",
      details: {
        failClosed: false,
        statusCode: "disabled",
      },
    });
  });

  it("uses distributed quota reservations before persisting usage", async () => {
    let reserveMode: "allow-catch-up" | "deny" = "allow-catch-up";
    const quotaCoordinator: QuotaCoordinator = {
      async reserve(input) {
        const bucket = input.buckets[0];
        if (bucket === undefined) return { allowed: true, reservations: [] };
        if (reserveMode === "deny") {
          return {
            allowed: false,
            bucketId: bucket.id,
            used: 10,
            limit: bucket.limit,
          };
        }
        return {
          allowed: true,
          reservations: [{ bucketId: bucket.id, used: 9 }],
        };
      },
      async status() {
        return {
          driver: "valkey",
          enabled: true,
          configured: true,
          healthy: true,
          keyPrefix: "romeo:quota:test",
          checkedAt: new Date().toISOString(),
          details: { failClosed: true, statusCode: "healthy" },
        };
      },
      async syncBucket() {},
      async deleteBucket() {},
    };
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      quotaCoordinator,
    });
    await createQuota(api, "tool.call", 10);

    const allowedResponse = await api.request(
      "/api/v1/tools/tool_calculator/execute",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentId: "agent_default",
          input: { expression: "2 + 2" },
        }),
      },
    );
    const afterAllowedResponse = await api.request("/api/v1/quotas");
    const afterAllowed = await afterAllowedResponse.json();

    reserveMode = "deny";
    const deniedResponse = await api.request(
      "/api/v1/tools/tool_calculator/execute",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentId: "agent_default",
          input: { expression: "2 + 2" },
        }),
      },
    );
    const denied = await deniedResponse.json();
    const afterDeniedResponse = await api.request("/api/v1/quotas");
    const afterDenied = await afterDeniedResponse.json();

    expect(allowedResponse.status).toBe(200);
    expect(afterAllowed.data[0].used).toBe(9);
    expect(deniedResponse.status).toBe(429);
    expect(denied.error.code).toBe("quota_exceeded");
    expect(denied.error.details).toMatchObject({
      metric: "tool.call",
      used: 10,
      requested: 1,
    });
    expect(afterDenied.data[0].used).toBe(9);
  });

  it("updates, resets, and deletes quota buckets", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const createResponse = await createQuota(api, "tool.call", 2);
    const created = await createResponse.json();

    await api.request("/api/v1/tools/tool_calculator/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentId: "agent_default",
        input: { expression: "2 + 2" },
      }),
    });

    const updateResponse = await api.request(
      `/api/v1/quotas/${created.data.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          limit: 4,
          resetInterval: "daily",
          resetUsage: true,
        }),
      },
    );
    const updated = await updateResponse.json();

    const deleteResponse = await api.request(
      `/api/v1/quotas/${created.data.id}`,
      { method: "DELETE" },
    );
    const listResponse = await api.request("/api/v1/quotas");
    const listed = await listResponse.json();

    expect(updateResponse.status).toBe(200);
    expect(updated.data.limit).toBe(4);
    expect(updated.data.used).toBe(0);
    expect(updated.data.resetInterval).toBe("daily");
    expect(updated.data.resetAt).toBeDefined();
    expect(deleteResponse.status).toBe(200);
    expect(listed.data).toEqual([]);
  });

  it("resets due quota buckets before enforcing the next request", async () => {
    const repository = new InMemoryRomeoRepository();
    const now = new Date().toISOString();
    await repository.createQuotaBucket({
      id: "quota_due_tool_call",
      orgId: "org_default",
      scopeType: "org",
      scopeId: "org_default",
      metric: "tool.call",
      limit: 1,
      used: 1,
      resetInterval: "daily",
      resetAt: "2020-01-01T00:00:00.000Z",
      createdAt: now,
      updatedAt: now,
    });
    const api = createRomeoApi(repository);

    const response = await api.request(
      "/api/v1/tools/tool_calculator/execute",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentId: "agent_default",
          input: { expression: "2 + 2" },
        }),
      },
    );
    const body = await response.json();
    const quotasResponse = await api.request("/api/v1/quotas");
    const quotas = await quotasResponse.json();

    expect(response.status).toBe(200);
    expect(body.data.result).toBe(4);
    expect(quotas.data[0].used).toBe(1);
    expect(new Date(quotas.data[0].resetAt).getTime()).toBeGreaterThan(
      Date.now(),
    );
  });

  it("blocks tool execution when the tool call quota is exhausted", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    await createQuota(api, "tool.call", 0);

    const response = await api.request(
      "/api/v1/tools/tool_calculator/execute",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentId: "agent_default",
          input: { expression: "2 + 2" },
        }),
      },
    );
    const body = await response.json();

    const auditResponse = await api.request("/api/v1/audit-logs");
    const audit = await auditResponse.json();
    const usageResponse = await api.request("/api/v1/usage/events");
    const usage = await usageResponse.json();

    expect(response.status).toBe(429);
    expect(body.error.code).toBe("quota_exceeded");
    expect(body.error.details.metric).toBe("tool.call");
    expect(
      audit.data.some(
        (log: { action: string }) => log.action === "tool.execute",
      ),
    ).toBe(false);
    expect(usage.data).toEqual([]);
  });

  it("blocks knowledge source registration when storage quota is exhausted", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    await createQuota(api, "storage.byte", 10);

    const response = await api.request(
      "/api/v1/knowledge-bases/kb_default/sources",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: "controls.md",
          mimeType: "text/markdown",
          sizeBytes: 128,
        }),
      },
    );
    const body = await response.json();
    const usageResponse = await api.request("/api/v1/usage/events");
    const usage = await usageResponse.json();

    expect(response.status).toBe(429);
    expect(body.error.code).toBe("quota_exceeded");
    expect(body.error.details.metric).toBe("storage.byte");
    expect(usage.data).toEqual([]);
  });

  it("blocks storage through a workspace-scoped quota", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    await createQuota(api, "storage.byte", 10, {
      scopeType: "workspace",
      scopeId: "workspace_default",
    });

    const response = await api.request(
      "/api/v1/knowledge-bases/kb_default/sources",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: "workspace-controls.md",
          mimeType: "text/markdown",
          sizeBytes: 128,
        }),
      },
    );
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.error.details.metric).toBe("storage.byte");
  });

  it("blocks tool execution through an agent-scoped quota", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    await createQuota(api, "tool.call", 0, {
      scopeType: "agent",
      scopeId: "agent_default",
    });

    const response = await api.request(
      "/api/v1/tools/tool_calculator/execute",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentId: "agent_default",
          input: { expression: "2 + 2" },
        }),
      },
    );
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.error.details.metric).toBe("tool.call");
  });

  it("blocks tool execution through an API-key scoped quota", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const apiKeyResponse = await api.request("/api/v1/api-keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Quota key", scopes: ["tools:use"] }),
    });
    const apiKey = await apiKeyResponse.json();
    await createQuota(api, "tool.call", 0, {
      scopeType: "api_key",
      scopeId: apiKey.data.apiKey.id,
    });

    const response = await api.request(
      "/api/v1/tools/tool_calculator/execute",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey.data.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          agentId: "agent_default",
          input: { expression: "2 + 2" },
        }),
      },
    );
    const body = await response.json();

    expect(apiKeyResponse.status).toBe(201);
    expect(response.status).toBe(429);
    expect(body.error.code).toBe("quota_exceeded");
    expect(body.error.details.metric).toBe("tool.call");
  });

  it("blocks runs before messages are persisted when run quota is exhausted", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const chatResponse = await api.request("/api/v1/chats", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        title: "Quota test",
      }),
    });
    const chat = await chatResponse.json();
    await createQuota(api, "run.started", 0);

    const response = await api.request("/api/v1/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chatId: chat.data.id,
        agentId: "agent_default",
        content: "Should be blocked.",
      }),
    });
    const body = await response.json();

    const messagesResponse = await api.request(
      `/api/v1/chats/${chat.data.id}/messages`,
    );
    const messages = await messagesResponse.json();

    expect(response.status).toBe(429);
    expect(body.error.code).toBe("quota_exceeded");
    expect(body.error.details.metric).toBe("run.started");
    expect(messages.data).toEqual([]);
  });

  it("blocks runs through a provider-scoped quota", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const chatResponse = await api.request("/api/v1/chats", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        title: "Provider quota test",
      }),
    });
    const chat = await chatResponse.json();
    await createQuota(api, "run.started", 0, {
      scopeType: "provider",
      scopeId: "provider_openai_compatible",
    });

    const response = await api.request("/api/v1/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chatId: chat.data.id,
        agentId: "agent_default",
        content: "Should be blocked by provider quota.",
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.error.details.metric).toBe("run.started");
  });

  it("applies billing plan quota templates to organization quotas", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());

    const currentResponse = await api.request("/api/v1/billing/plan");
    const current = await currentResponse.json();
    const applyResponse = await api.request("/api/v1/billing/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: "team",
        name: "Team",
        status: "active",
        source: "manual",
        quotaTemplates: [
          { metric: "run.started", limit: 1000, resetInterval: "monthly" },
          { metric: "tool.call", limit: 5000, resetInterval: "monthly" },
        ],
      }),
    });
    const applied = await applyResponse.json();
    const planResponse = await api.request("/api/v1/billing/plan");
    const plan = await planResponse.json();
    const quotasResponse = await api.request("/api/v1/quotas");
    const quotas = await quotasResponse.json();
    const auditResponse = await api.request("/api/v1/audit-logs");
    const audit = await auditResponse.json();

    expect(current.data).toBeNull();
    expect(applyResponse.status).toBe(200);
    expect(applied.data.plan.code).toBe("team");
    expect(applied.data.quotas).toHaveLength(2);
    expect(plan.data.quotaTemplates).toHaveLength(2);
    expect(
      quotas.data.map((quota: { metric: string; limit: number }) => [
        quota.metric,
        quota.limit,
      ]),
    ).toEqual([
      ["run.started", 1000],
      ["tool.call", 5000],
    ]);
    expect(
      audit.data.some(
        (log: { action: string; metadata: Record<string, unknown> }) =>
          log.action === "billing.plan_applied" && log.metadata.code === "team",
      ),
    ).toBe(true);
  });

  it("reports and reconciles billing entitlement quota drift", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const applyResponse = await api.request("/api/v1/billing/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: "team",
        name: "Team",
        status: "active",
        source: "manual",
        quotaTemplates: [
          { metric: "run.started", limit: 1000, resetInterval: "monthly" },
          { metric: "tool.call", limit: 5000, resetInterval: "monthly" },
        ],
      }),
    });
    const applied = await applyResponse.json();
    const runQuota = applied.data.quotas.find(
      (quota: { metric: string }) => quota.metric === "run.started",
    );
    const toolQuota = applied.data.quotas.find(
      (quota: { metric: string }) => quota.metric === "tool.call",
    );
    await api.request(`/api/v1/quotas/${runQuota.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ limit: 1, resetInterval: "daily" }),
    });
    await api.request(`/api/v1/quotas/${toolQuota.id}`, { method: "DELETE" });

    const reportResponse = await api.request("/api/v1/billing/entitlements");
    const report = await reportResponse.json();
    const reconcileResponse = await api.request(
      "/api/v1/billing/entitlements/reconcile",
      { method: "POST" },
    );
    const reconciled = await reconcileResponse.json();
    const auditResponse = await api.request("/api/v1/audit-logs");
    const audit = await auditResponse.json();

    expect(reportResponse.status).toBe(200);
    expect(report.data.status).toBe("attention_required");
    expect(report.data.warnings).toEqual([
      "quota_limit_mismatch",
      "quota_missing",
      "quota_reset_interval_mismatch",
    ]);
    expect(
      report.data.quotas.find(
        (quota: { metric: string }) => quota.metric === "run.started",
      ).status,
    ).toBe("limit_and_reset_interval_mismatch");
    expect(
      report.data.quotas.find(
        (quota: { metric: string }) => quota.metric === "tool.call",
      ).status,
    ).toBe("missing");
    expect(reconcileResponse.status).toBe(200);
    expect(reconciled.data.before.status).toBe("attention_required");
    expect(reconciled.data.after.status).toBe("healthy");
    expect(reconciled.data.actions.createdQuotaIds).toHaveLength(1);
    expect(reconciled.data.actions.updatedQuotaIds).toEqual([runQuota.id]);
    expect(
      reconciled.data.after.quotas.map(
        (quota: { metric: string; status: string }) => [
          quota.metric,
          quota.status,
        ],
      ),
    ).toEqual([
      ["run.started", "matched"],
      ["tool.call", "matched"],
    ]);
    expect(
      audit.data.some(
        (log: { action: string; metadata: Record<string, unknown> }) =>
          log.action === "billing.entitlements_reconciled" &&
          log.metadata.createdQuotaCount === 1 &&
          log.metadata.updatedQuotaCount === 1,
      ),
    ).toBe(true);
  });

  it("reports and enforces expired billing lifecycle deadlines", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    await api.request("/api/v1/billing/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: "trial",
        name: "Trial",
        status: "trialing",
        quotaTemplates: [
          { metric: "run.started", limit: 100, resetInterval: "monthly" },
        ],
        lifecycle: {
          trialEndsAt: "2020-01-01T00:00:00.000Z",
          currentPeriodEndsAt: "2099-01-01T00:00:00.000Z",
        },
      }),
    });

    const reportResponse = await api.request("/api/v1/billing/lifecycle");
    const report = await reportResponse.json();
    const enforceResponse = await api.request(
      "/api/v1/billing/lifecycle/enforce",
      { method: "POST" },
    );
    const enforced = await enforceResponse.json();
    const planResponse = await api.request("/api/v1/billing/plan");
    const plan = await planResponse.json();
    const auditResponse = await api.request("/api/v1/audit-logs");
    const audit = await auditResponse.json();

    expect(reportResponse.status).toBe(200);
    expect(report.data).toMatchObject({
      status: "attention_required",
      recommendedAction: "mark_past_due",
      warnings: ["trial_expired"],
      lifecycle: {
        trialEndsAt: "2020-01-01T00:00:00.000Z",
      },
      billingPlan: {
        status: "trialing",
      },
    });
    expect(enforceResponse.status).toBe(200);
    expect(enforced.data.action).toMatchObject({
      type: "mark_past_due",
      statusChanged: true,
      previousStatus: "trialing",
      newStatus: "past_due",
    });
    expect(enforced.data.after).toMatchObject({
      status: "healthy",
      recommendedAction: "none",
      billingPlan: {
        status: "past_due",
      },
    });
    expect(plan.data.status).toBe("past_due");
    expect(plan.data.metadata).toMatchObject({
      billingLifecycle: {
        trialEndsAt: "2020-01-01T00:00:00.000Z",
        currentPeriodEndsAt: "2099-01-01T00:00:00.000Z",
      },
      billingLifecycleLastAction: "mark_past_due",
    });
    expect(
      audit.data.some(
        (log: { action: string; metadata: Record<string, unknown> }) =>
          log.action === "billing.lifecycle_enforced" &&
          log.metadata.statusChanged === true &&
          log.metadata.action === "mark_past_due",
      ),
    ).toBe(true);
  });

  it("updates abuse controls and blocks suspended tenant work before side effects persist", async () => {
    const repository = new InMemoryRomeoRepository();
    const api = createRomeoApi(repository, {
      embeddingFetch: async () => {
        throw new Error(
          "Suspended tenant embedding provider call was reached.",
        );
      },
      env: readEnv({
        WEBHOOK_SIGNING_KEY: "test-webhook-signing-key-32-bytes",
      }),
      providerFetch: async () => {
        throw new Error("Suspended tenant model provider call was reached.");
      },
    });
    const chatResponse = await api.request("/api/v1/chats", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        title: "Suspension test",
      }),
    });
    const chat = await chatResponse.json();
    const workflowCreateResponse = await api.request("/api/v1/workflows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        name: "Suspension workflow",
        steps: [
          {
            type: "notification",
            name: "Notify",
            message: "Should not run while suspended.",
          },
        ],
      }),
    });
    const workflow = await workflowCreateResponse.json();
    const connectorCreateResponse = await api.request(
      "/api/v1/data-connectors",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: "workspace_default",
          knowledgeBaseId: "kb_default",
          type: "local_import",
          name: "Suspension connector",
          config: {},
        }),
      },
    );
    const connector = await connectorCreateResponse.json();
    const webhookCreateResponse = await api.request("/api/v1/webhooks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "https://hooks.example.com/romeo",
        eventTypes: ["webhook.test"],
      }),
    });
    const webhook = await webhookCreateResponse.json();
    const evalSuiteResponse = await api.request("/api/v1/eval-suites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agentId: "agent_default",
        name: "Suspension eval",
        cases: [{ input: "This eval provider call should be blocked." }],
      }),
    });
    const evalSuite = await evalSuiteResponse.json();

    const updateResponse = await api.request("/api/v1/admin/abuse-controls", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        suspension: {
          suspended: true,
          reasonCode: "abuse_review",
        },
      }),
    });
    const updated = await updateResponse.json();
    const reportResponse = await api.request("/api/v1/admin/abuse-controls");
    const report = await reportResponse.json();
    const runResponse = await api.request("/api/v1/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chatId: chat.data.id,
        agentId: "agent_default",
        content: "Should be blocked by suspension.",
      }),
    });
    const runError = await runResponse.json();
    const toolResponse = await api.request(
      "/api/v1/tools/tool_calculator/execute",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentId: "agent_default",
          input: { expression: "2 + 2" },
        }),
      },
    );
    const toolError = await toolResponse.json();
    const chatCompletionResponse = await api.request(
      "/api/v1/chat/completions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "model_openai_compatible_default",
          messages: [{ role: "user", content: "Should be blocked." }],
        }),
      },
    );
    const chatCompletionError = await chatCompletionResponse.json();
    const embeddingResponse = await api.request("/api/v1/embeddings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: "This embedding request should be blocked.",
      }),
    });
    const embeddingError = await embeddingResponse.json();
    const evalRunResponse = await api.request(
      `/api/v1/eval-suites/${evalSuite.data.suite.id}/runs`,
      { method: "POST" },
    );
    const evalRunError = await evalRunResponse.json();
    const voicePreviewResponse = await api.request(
      "/api/v1/voices/voice_default/preview",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "This voice preview should be blocked." }),
      },
    );
    const voicePreviewError = await voicePreviewResponse.json();
    const voiceTranscriptionResponse = await api.request(
      "/api/v1/voice/transcriptions",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          audioBase64: Buffer.from(new Uint8Array([1, 2, 3, 4])).toString(
            "base64",
          ),
          contentType: "audio/wav",
        }),
      },
    );
    const voiceTranscriptionError = await voiceTranscriptionResponse.json();
    const voiceSyncResponse = await api.request("/api/v1/voices/sync", {
      method: "POST",
    });
    const voiceSyncError = await voiceSyncResponse.json();
    const webhookTestResponse = await api.request(
      `/api/v1/webhooks/${webhook.data.subscription.id}/test`,
      { method: "POST" },
    );
    const webhookTestError = await webhookTestResponse.json();
    const webhookRetryResponse = await api.request(
      "/api/v1/webhook-deliveries/retry-due",
      { method: "POST" },
    );
    const webhookRetryError = await webhookRetryResponse.json();
    const notificationRetryResponse = await api.request(
      "/api/v1/notification-deliveries/retry-due",
      { method: "POST" },
    );
    const notificationRetryError = await notificationRetryResponse.json();
    const scheduledWorkflowCreateResponse = await api.request(
      "/api/v1/workflows",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: "workspace_default",
          name: "Blocked scheduled workflow",
          steps: [
            {
              type: "notification",
              name: "Notify later",
              message: "Should not be scheduled while suspended.",
            },
          ],
          schedule: { intervalMinutes: 5 },
        }),
      },
    );
    const scheduledWorkflowError = await scheduledWorkflowCreateResponse.json();
    const scheduledConnectorCreateResponse = await api.request(
      "/api/v1/data-connectors",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          workspaceId: "workspace_default",
          knowledgeBaseId: "kb_default",
          type: "local_import",
          name: "Blocked scheduled connector",
          config: {},
          syncIntervalMinutes: 5,
        }),
      },
    );
    const scheduledConnectorError =
      await scheduledConnectorCreateResponse.json();
    const connectorSyncResponse = await api.request(
      `/api/v1/data-connectors/${connector.data.id}/sync`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: [
            {
              fileName: "blocked.md",
              mimeType: "text/markdown",
              content: "This connector sync should be blocked.",
            },
          ],
        }),
      },
    );
    const connectorSyncError = await connectorSyncResponse.json();
    const workflowRunResponse = await api.request(
      `/api/v1/workflows/${workflow.data.id}/runs`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: { route: "blocked" } }),
      },
    );
    const workflowRunError = await workflowRunResponse.json();
    const uploadResponse = await api.request("/api/v1/files/uploads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        fileName: "blocked.txt",
        mimeType: "text/plain",
        sizeBytes: 7,
        sha256:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      }),
    });
    const uploadError = await uploadResponse.json();
    const messagesResponse = await api.request(
      `/api/v1/chats/${chat.data.id}/messages`,
    );
    const messages = await messagesResponse.json();
    const workflowRunsResponse = await api.request(
      `/api/v1/workflows/${workflow.data.id}/runs`,
    );
    const workflowRuns = await workflowRunsResponse.json();
    const connectorSyncsResponse = await api.request(
      `/api/v1/data-connectors/${connector.data.id}/syncs`,
    );
    const connectorSyncs = await connectorSyncsResponse.json();
    const filesResponse = await api.request(
      "/api/v1/files?workspaceId=workspace_default",
    );
    const files = await filesResponse.json();
    const auditResponse = await api.request("/api/v1/audit-logs");
    const audit = await auditResponse.json();

    expect(workflowCreateResponse.status).toBe(201);
    expect(connectorCreateResponse.status).toBe(201);
    expect(webhookCreateResponse.status).toBe(201);
    expect(evalSuiteResponse.status).toBe(201);
    expect(updateResponse.status).toBe(200);
    expect(updated.data).toMatchObject({
      source: "org",
      suspension: { suspended: true, reasonCode: "abuse_review" },
    });
    expect(report.data.enforcement).toMatchObject({
      costWorkBlocked: true,
      defaultBlockReasons: ["org_suspended"],
    });
    expect(runResponse.status).toBe(403);
    expect(runError.error.code).toBe("abuse_control_blocked");
    expect(runError.error.details.reasonCodes).toEqual(["org_suspended"]);
    expect(toolResponse.status).toBe(403);
    expect(toolError.error.details).toMatchObject({
      action: "tool.execute",
      reasonCodes: ["org_suspended"],
    });
    expect(chatCompletionResponse.status).toBe(403);
    expect(chatCompletionError.error.details).toMatchObject({
      action: "model.request",
      reasonCodes: ["org_suspended"],
    });
    expect(embeddingResponse.status).toBe(403);
    expect(embeddingError.error.details).toMatchObject({
      action: "model.request",
      reasonCodes: ["org_suspended"],
    });
    expect(evalRunResponse.status).toBe(403);
    expect(evalRunError.error.details).toMatchObject({
      action: "eval.run",
      reasonCodes: ["org_suspended"],
    });
    expect(voicePreviewResponse.status).toBe(403);
    expect(voicePreviewError.error.details).toMatchObject({
      action: "voice.request",
      reasonCodes: ["org_suspended"],
    });
    expect(voiceTranscriptionResponse.status).toBe(403);
    expect(voiceTranscriptionError.error.details).toMatchObject({
      action: "voice.request",
      reasonCodes: ["org_suspended"],
    });
    expect(voiceSyncResponse.status).toBe(403);
    expect(voiceSyncError.error.details).toMatchObject({
      action: "voice.request",
      reasonCodes: ["org_suspended"],
    });
    expect(webhookTestResponse.status).toBe(403);
    expect(webhookTestError.error.details).toMatchObject({
      action: "worker.enqueue",
      reasonCodes: ["org_suspended"],
    });
    expect(webhookRetryResponse.status).toBe(403);
    expect(webhookRetryError.error.details).toMatchObject({
      action: "worker.enqueue",
      reasonCodes: ["org_suspended"],
    });
    expect(notificationRetryResponse.status).toBe(403);
    expect(notificationRetryError.error.details).toMatchObject({
      action: "worker.enqueue",
      reasonCodes: ["org_suspended"],
    });
    expect(scheduledWorkflowCreateResponse.status).toBe(403);
    expect(scheduledWorkflowError.error.details).toMatchObject({
      action: "worker.enqueue",
      reasonCodes: ["org_suspended"],
    });
    expect(scheduledConnectorCreateResponse.status).toBe(403);
    expect(scheduledConnectorError.error.details).toMatchObject({
      action: "worker.enqueue",
      reasonCodes: ["org_suspended"],
    });
    expect(connectorSyncResponse.status).toBe(403);
    expect(connectorSyncError.error.details).toMatchObject({
      action: "connector.sync",
      reasonCodes: ["org_suspended"],
    });
    expect(workflowRunResponse.status).toBe(403);
    expect(workflowRunError.error.details).toMatchObject({
      action: "workflow.run",
      reasonCodes: ["org_suspended"],
    });
    expect(uploadResponse.status).toBe(403);
    expect(uploadError.error.details).toMatchObject({
      action: "file.upload",
      reasonCodes: ["org_suspended"],
    });
    expect(messages.data).toEqual([]);
    expect(workflowRuns.data).toEqual([]);
    expect(connectorSyncs.data).toEqual([]);
    expect(files.data).toEqual([]);
    expect(
      audit.data.some(
        (log: { action: string; metadata: Record<string, unknown> }) =>
          log.action === "admin.abuse_controls.update" &&
          log.metadata.suspended === true,
      ),
    ).toBe(true);
    expect(
      audit.data.some(
        (log: {
          action: string;
          outcome: string;
          metadata: Record<string, unknown>;
        }) =>
          log.action === "abuse_control.enforcement_blocked" &&
          log.outcome === "failure" &&
          Array.isArray(log.metadata.reasonCodes) &&
          log.metadata.reasonCodes.includes("org_suspended"),
      ),
    ).toBe(true);
  });

  it("enforces billing entitlement status and scoped kill switches", async () => {
    const billingApi = createRomeoApi(new InMemoryRomeoRepository());
    const chatResponse = await billingApi.request("/api/v1/chats", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        title: "Billing entitlement test",
      }),
    });
    const chat = await chatResponse.json();
    await billingApi.request("/api/v1/billing/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: "past-due-plan",
        name: "Past Due",
        status: "past_due",
        quotaTemplates: [
          { metric: "run.started", limit: 1000, resetInterval: "monthly" },
        ],
      }),
    });
    await billingApi.request("/api/v1/admin/abuse-controls", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        entitlements: {
          enforceBillingStatus: true,
          denyWhenBillingPlanMissing: true,
          allowedBillingStatuses: ["active", "trialing"],
        },
      }),
    });

    const billingBlockedResponse = await billingApi.request("/api/v1/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chatId: chat.data.id,
        agentId: "agent_default",
        content: "Should be blocked by billing status.",
      }),
    });
    const billingBlocked = await billingBlockedResponse.json();

    const killSwitchApi = createRomeoApi(new InMemoryRomeoRepository());
    await killSwitchApi.request("/api/v1/admin/abuse-controls", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        killSwitches: {
          toolIds: ["tool_calculator"],
          workerClasses: ["knowledge.ingest"],
        },
      }),
    });
    const toolResponse = await killSwitchApi.request(
      "/api/v1/tools/tool_calculator/execute",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentId: "agent_default",
          input: { expression: "2 + 2" },
        }),
      },
    );
    const toolBlocked = await toolResponse.json();
    const knowledgeResponse = await killSwitchApi.request(
      "/api/v1/knowledge-bases/kb_default/sources",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: "blocked.md",
          mimeType: "text/markdown",
          sizeBytes: 12,
          content: "blocked",
        }),
      },
    );
    const knowledgeBlocked = await knowledgeResponse.json();

    expect(billingBlockedResponse.status).toBe(403);
    expect(billingBlocked.error.details.reasonCodes).toEqual([
      "billing_status_blocked",
    ]);
    expect(toolResponse.status).toBe(403);
    expect(toolBlocked.error.details.reasonCodes).toEqual(["tool_kill_switch"]);
    expect(knowledgeResponse.status).toBe(403);
    expect(knowledgeBlocked.error.details.reasonCodes).toEqual([
      "worker_class_kill_switch",
    ]);
  });

  it("applies storage-byte quotas to file uploads", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    await createQuota(api, "storage.byte", 4);

    const response = await api.request("/api/v1/files", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        fileName: "quota.txt",
        mimeType: "text/plain",
        sizeBytes: 5,
        dataBase64: Buffer.from("12345").toString("base64"),
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(body.error.code).toBe("quota_exceeded");
    expect(body.error.details.metric).toBe("storage.byte");
  });

  it("syncs external billing lifecycle events into the current plan without raw provider payloads", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());

    const syncResponse = await api.request("/api/v1/billing/external-events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "stripe",
        eventType: "invoice.paid",
        externalCustomerId: "cus_123",
        externalSubscriptionId: "sub_123",
        externalInvoiceId: "in_123",
        invoiceStatus: "paid",
        amountCents: 2500,
        currency: "USD",
        planCode: "team",
        planName: "Team",
        quotaTemplates: [
          { metric: "run.started", limit: 1000, resetInterval: "monthly" },
        ],
        lifecycle: {
          currentPeriodEndsAt: "2099-01-01T00:00:00.000Z",
          pastDueGraceEndsAt: "2099-02-01T00:00:00.000Z",
        },
        metadata: {
          rawCustomerEmail: "customer@example.com",
          rawPayload: { shouldNotPersist: true },
        },
      }),
    });
    const synced = await syncResponse.json();
    const planResponse = await api.request("/api/v1/billing/plan");
    const plan = await planResponse.json();
    const auditResponse = await api.request("/api/v1/audit-logs");
    const audit = await auditResponse.json();

    expect(syncResponse.status).toBe(200);
    expect(synced.data.plan).toMatchObject({
      code: "team",
      source: "external",
      status: "active",
      externalCustomerId: "cus_123",
      externalSubscriptionId: "sub_123",
    });
    expect(plan.data.metadata).toMatchObject({
      billingProvider: "stripe",
      lastExternalEventType: "invoice.paid",
      lastInvoice: {
        externalInvoiceId: "in_123",
        status: "paid",
        amountCents: 2500,
        currency: "USD",
      },
      billingLifecycle: {
        currentPeriodEndsAt: "2099-01-01T00:00:00.000Z",
        pastDueGraceEndsAt: "2099-02-01T00:00:00.000Z",
      },
      externalMetadataKeys: ["rawCustomerEmail", "rawPayload"],
    });
    expect(JSON.stringify(plan.data.metadata)).not.toContain(
      "customer@example.com",
    );
    expect(JSON.stringify(plan.data.metadata)).not.toContain(
      "shouldNotPersist",
    );
    expect(
      audit.data.some(
        (log: { action: string; metadata: Record<string, unknown> }) =>
          log.action === "billing.external_event_synced" &&
          log.metadata.eventType === "invoice.paid",
      ),
    ).toBe(true);
  });

  it("accepts signed Stripe billing webhooks without requiring API authentication", async () => {
    const repository = new InMemoryRomeoRepository();
    const setupApi = createRomeoApi(repository);
    await setupApi.request("/api/v1/billing/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: "team",
        name: "Team",
        quotaTemplates: [
          { metric: "run.started", limit: 1000, resetInterval: "monthly" },
        ],
      }),
    });
    const secret = "whsec_test_secret_1234567890";
    const api = createRomeoApi(repository, {
      env: readEnv({
        DEV_SEEDED_LOGIN: "false",
        SESSION_SECRET: "prod-session-secret-32-bytes-long",
        WEBHOOK_SIGNING_KEY: "prod-webhook-signing-key-32-bytes",
        BILLING_STRIPE_WEBHOOK_SECRET: secret,
      }),
    });
    const payload = JSON.stringify({
      id: "evt_invoice_paid",
      type: "invoice.paid",
      created: 1_700_000_000,
      data: {
        object: {
          id: "in_123",
          object: "invoice",
          customer: "cus_123",
          subscription: "sub_123",
          status: "paid",
          amount_paid: 2500,
          currency: "usd",
          metadata: { private_note: "do-not-persist", romeo_plan_code: "team" },
        },
      },
    });
    const signature = stripeSignature(payload, secret);

    const response = await api.request("/api/v1/billing/webhooks/stripe", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": signature,
      },
      body: payload,
    });
    const synced = await response.json();
    const planResponse = await setupApi.request("/api/v1/billing/plan");
    const plan = await planResponse.json();
    const auditResponse = await setupApi.request("/api/v1/audit-logs");
    const audit = await auditResponse.json();
    const systemActor = await repository.getCurrentUser(
      "system_billing_webhook",
    );

    expect(response.status).toBe(200);
    expect(synced.data.plan).toMatchObject({
      source: "external",
      externalCustomerId: "cus_123",
      externalSubscriptionId: "sub_123",
    });
    expect(plan.data.metadata).toMatchObject({
      billingProvider: "stripe",
      lastExternalEventType: "invoice.paid",
      lastInvoice: {
        externalInvoiceId: "in_123",
        status: "paid",
        amountCents: 2500,
        currency: "USD",
      },
    });
    expect(
      audit.data.some(
        (log: { actorId: string; action: string }) =>
          log.actorId === "system_billing_webhook" &&
          log.action === "billing.external_event_synced",
      ),
    ).toBe(true);
    expect(systemActor).toMatchObject({
      id: "system_billing_webhook",
      orgId: "org_default",
      name: "Romeo system billing webhook",
      disabledAt: expect.any(String),
    });
    expect(JSON.stringify(plan.data.metadata)).not.toContain("do-not-persist");
    expect(JSON.stringify(audit.data)).not.toContain("do-not-persist");
  });

  it("accepts signed generic billing webhooks without requiring API authentication", async () => {
    const repository = new InMemoryRomeoRepository();
    const secret = "generic_test_secret_1234567890";
    const api = createRomeoApi(repository, {
      env: readEnv({
        DEV_SEEDED_LOGIN: "false",
        SESSION_SECRET: "prod-session-secret-32-bytes-long",
        WEBHOOK_SIGNING_KEY: "prod-webhook-signing-key-32-bytes",
        BILLING_GENERIC_WEBHOOK_SECRET: secret,
      }),
    });
    const payload = JSON.stringify({
      provider: "paddle-proxy",
      eventType: "subscription.updated",
      externalCustomerId: "customer_123",
      externalSubscriptionId: "subscription_123",
      planCode: "enterprise",
      planName: "Enterprise",
      status: "active",
      quotaTemplates: [
        { metric: "run.started", limit: 5000, resetInterval: "monthly" },
      ],
      lifecycle: {
        cancelAt: "2099-01-01T00:00:00.000Z",
      },
      metadata: {
        private_note: "do-not-persist",
        public_key: "value-present-only-as-key",
      },
    });
    const signature = genericBillingSignature(payload, secret);

    const response = await api.request("/api/v1/billing/webhooks/generic", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-romeo-billing-signature": signature.signature,
        "x-romeo-billing-timestamp": signature.timestamp,
      },
      body: payload,
    });
    const synced = await response.json();
    const planResponse = await createRomeoApi(repository).request(
      "/api/v1/billing/plan",
    );
    const plan = await planResponse.json();

    expect(response.status).toBe(200);
    expect(synced.data.plan).toMatchObject({
      code: "enterprise",
      source: "external",
      externalCustomerId: "customer_123",
      externalSubscriptionId: "subscription_123",
    });
    expect(plan.data.metadata).toMatchObject({
      billingProvider: "paddle-proxy",
      lastExternalEventType: "subscription.updated",
      billingLifecycle: {
        cancelAt: "2099-01-01T00:00:00.000Z",
      },
      externalMetadataKeys: ["private_note", "public_key"],
    });
    expect(JSON.stringify(plan.data.metadata)).not.toContain("do-not-persist");
    expect(JSON.stringify(plan.data.metadata)).not.toContain(
      "value-present-only-as-key",
    );
  });

  it("rejects Stripe billing webhooks with invalid signatures", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: readEnv({
        DEV_SEEDED_LOGIN: "false",
        SESSION_SECRET: "prod-session-secret-32-bytes-long",
        WEBHOOK_SIGNING_KEY: "prod-webhook-signing-key-32-bytes",
        BILLING_STRIPE_WEBHOOK_SECRET: "whsec_test_secret_1234567890",
      }),
    });

    const response = await api.request("/api/v1/billing/webhooks/stripe", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": stripeSignature(
          '{"type":"invoice.paid"}',
          "wrong_secret",
        ),
      },
      body: '{"type":"invoice.paid"}',
    });
    const error = await response.json();

    expect(response.status).toBe(401);
    expect(error.error.code).toBe("billing_webhook_signature_invalid");
  });
});

function createQuota(
  api: ReturnType<typeof createRomeoApi>,
  metric: string,
  limit: number,
  options: {
    scopeId?: string;
    scopeType?: "org" | "user" | "workspace" | "provider" | "agent" | "api_key";
  } = {},
) {
  const body = {
    scopeType: options.scopeType ?? "org",
    metric,
    limit,
    ...(options.scopeId !== undefined ? { scopeId: options.scopeId } : {}),
  };
  return api.request("/api/v1/quotas", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function stripeSignature(payload: string, secret: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

function genericBillingSignature(
  payload: string,
  secret: string,
): { signature: string; timestamp: string } {
  const timestamp = Math.floor(Date.now() / 1000);
  return {
    signature: `v1=${createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex")}`,
    timestamp: String(timestamp),
  };
}

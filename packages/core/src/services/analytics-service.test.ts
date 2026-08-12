import { describe, expect, it } from "vitest";
import type { AuthSubject } from "@romeo/auth";

import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { AnalyticsService, formatAdminAnalyticsSummaryCsv } from "./analytics-service";
import { summarizeBackgroundJobs } from "./job-service";
import type { ProviderOperationalSummary } from "./provider-operational-summary";

const subject: AuthSubject = {
  id: "user_analytics",
  type: "user",
  orgId: "org_default",
  workspaceIds: ["workspace_default"],
  groupIds: [],
  scopes: ["admin:read", "usage:read"],
};

describe("AnalyticsService.summary", () => {
  it("filters usage by window, backfills token cost, and flags model attention", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.upsertModels([
      {
        id: "model_priced",
        providerId: "provider_openai_compatible",
        name: "priced",
        displayName: "Priced",
        enabled: true,
        capabilities: (
          await repository.listModels(subject.orgId)
        )[0]!.capabilities,
        contextWindow: 8000,
        pricing: { inputTokenUsd: 0.001, outputTokenUsd: 0.002 },
        defaultParameters: { maxOutputTokens: 1024 },
      },
    ]);
    await repository.createUsageEvent({
      id: "usage_old",
      orgId: subject.orgId,
      actorId: subject.id,
      sourceType: "run",
      sourceId: "run_old",
      metric: "run.started",
      quantity: 1,
      unit: "count",
      metadata: {},
      createdAt: "2026-07-01T00:00:00.000Z",
    });
    await repository.createUsageEvent({
      id: "usage_run",
      orgId: subject.orgId,
      actorId: subject.id,
      sourceType: "run",
      sourceId: "run_new",
      metric: "run.started",
      quantity: 1,
      unit: "count",
      metadata: {},
      createdAt: "2026-08-10T12:00:00.000Z",
    });
    await repository.createUsageEvent({
      id: "usage_tokens",
      orgId: subject.orgId,
      actorId: subject.id,
      sourceType: "run",
      sourceId: "run_new",
      metric: "llm.input_token.estimated",
      quantity: 10,
      unit: "token",
      metadata: { modelId: "model_priced" },
      createdAt: "2026-08-10T12:00:01.000Z",
    });
    await repository.createUsageEvent({
      id: "usage_noise",
      orgId: subject.orgId,
      actorId: subject.id,
      sourceType: "run",
      sourceId: "run_new",
      metric: "sse.reconnect",
      quantity: 1,
      unit: "count",
      metadata: {},
      createdAt: "2026-08-10T12:00:02.000Z",
    });

    const summary = await new AnalyticsService(repository).summary(subject, {
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-12T00:00:00.000Z",
      jobSummary: summarizeBackgroundJobs([]),
      providerSummary: emptyProviderSummary(),
    });

    expect(summary.window).toEqual({
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-08-12T00:00:00.000Z",
    });
    expect(summary.usage.eventCount).toBe(3);
    expect(summary.usage.activityEventCount).toBe(2);
    expect(summary.usage.runsStarted).toBe(1);
    expect(summary.usage.totalTokens).toBe(10);
    expect(summary.usage.estimatedCostUsd).toBeCloseTo(0.01);
    expect(summary.usage.unpricedTokenQuantity).toBe(0);
    expect(summary.attention.models.map((model) => model.modelId)).toEqual(
      expect.arrayContaining([
        "model_ollama_default",
        "model_openai_compatible_default",
      ]),
    );
    expect(
      summary.attention.models.find((model) => model.modelId === "model_priced"),
    ).toBeUndefined();

    const csv = formatAdminAnalyticsSummaryCsv(summary);
    expect(csv).toContain("usage,org,org_default,runs_started,1");
    expect(csv).toContain("attention,org,org_default,model_count,");
    expect(csv).toContain("missing_pricing");
  });
});

function emptyProviderSummary(): ProviderOperationalSummary {
  return {
    alerts: [],
    fallback: { available: true, configured: false },
    generatedAt: "2026-08-12T00:00:00.000Z",
    policy: {
      circuitCooldownMs: 60_000,
      circuitFailureThreshold: 3,
      disabledProviderIds: [],
      retryAttempts: 1,
      retryBackoffMs: 250,
      streamTimeoutMs: 60_000,
    },
    providers: [],
    runtime: {
      contextInputTokensAverage: 0,
      lookbackSeconds: 3600,
      objectStoreFailureCount: 0,
      providerErrorCount: 0,
      queueWaitP95Ms: 0,
      recoveryCount: 0,
      sseDisconnectCount: 0,
      sseReconnectCount: 0,
      timeToFirstTokenAverageMs: 0,
      timeToFirstTokenP95Ms: 0,
      uploadPipelineAverageMs: 0,
      webRetrievalAverageMs: 0,
      outputThroughputAverage: 0,
    },
    status: "healthy",
  };
}

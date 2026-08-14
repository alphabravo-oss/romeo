import { ProviderCircuitBreaker } from "@romeo/ai-runtime";
import { describe, expect, it } from "vitest";

import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { createProviderRoutingPolicy } from "./provider-routing";
import { summarizeProviderOperations } from "./provider-operational-summary";

describe("provider operational summary", () => {
  it("summarizes provider routing, circuit, and fallback state without provider endpoints", async () => {
    const repository = new InMemoryRomeoRepository();
    const circuitBreaker = new ProviderCircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 60_000,
    });
    circuitBreaker.recordFailure("provider_openai_compatible");

    const summary = await summarizeProviderOperations({
      circuitBreaker,
      now: "2026-06-30T00:00:00.000Z",
      options: {
        providerCircuitCooldownMs: 60_000,
        providerCircuitFailureThreshold: 1,
        providerDisabledIds: "provider_ollama",
        providerFallbackModelId: "model_ollama_default",
        providerRetryAttempts: 1,
        providerRetryBackoffMs: 250,
        providerStreamTimeoutMs: 60_000,
      },
      orgId: "org_default",
      repository,
      routingPolicy: createProviderRoutingPolicy({
        disabledProviderIds: "provider_ollama",
        fallbackModelId: "model_ollama_default",
      }),
    });

    expect(summary.status).toBe("critical");
    expect(summary.policy).toMatchObject({
      disabledProviderIds: ["provider_ollama"],
      fallbackModelId: "model_ollama_default",
      retryAttempts: 1,
    });
    expect(summary.fallback).toEqual({
      available: false,
      configured: true,
      modelId: "model_ollama_default",
      providerId: "provider_ollama",
      reason: "provider_disabled",
    });
    expect(
      summary.providers.find(
        (provider) => provider.providerId === "provider_openai_compatible",
      ),
    ).toMatchObject({
      circuit: { state: "open", consecutiveFailures: 1 },
      status: "unavailable",
      reasons: ["provider_circuit_open"],
    });
    expect(
      summary.alerts.map((alert) => `${alert.severity}:${alert.code}`),
    ).toEqual([
      "critical:fallback_unavailable",
      "critical:no_available_providers",
      "critical:provider_circuit_open",
      "critical:provider_kill_switch",
    ]);
    expect(JSON.stringify(summary)).not.toContain("api.openai.com");
    expect(JSON.stringify(summary)).not.toContain("localhost:11434");
  });

  it("reports degraded status when a kill-switched provider has an available fallback", async () => {
    const repository = new InMemoryRomeoRepository();
    const summary = await summarizeProviderOperations({
      circuitBreaker: new ProviderCircuitBreaker(),
      options: {
        providerDisabledIds: "provider_openai_compatible",
        providerFallbackModelId: "model_ollama_default",
      },
      orgId: "org_default",
      repository,
      routingPolicy: createProviderRoutingPolicy({
        disabledProviderIds: "provider_openai_compatible",
        fallbackModelId: "model_ollama_default",
      }),
    });

    expect(summary.status).toBe("degraded");
    expect(summary.fallback).toMatchObject({
      available: true,
      configured: true,
      modelId: "model_ollama_default",
      providerId: "provider_ollama",
    });
    expect(summary.alerts).toContainEqual({
      code: "provider_kill_switch",
      id: "provider_provider_kill_switch_provider_openai_compatible",
      providerId: "provider_openai_compatible",
      severity: "warning",
    });
  });

  it("summarizes recent metadata-only runtime signals and raises bounded alerts", async () => {
    const repository = new InMemoryRomeoRepository();
    const createdAt = "2026-07-16T12:00:00.000Z";
    const metrics = [
      ...Array.from(
        { length: 5 },
        () => ["provider.error", 1, "error", "run"] as const,
      ),
      ...Array.from(
        { length: 3 },
        () => ["sse.disconnect", 1, "connection", "run"] as const,
      ),
      ["sse.reconnect", 2, "connection", "run"] as const,
      ["queue.wait", 35_000, "millisecond", "run"] as const,
      ["run.time_to_first_token", 12_000, "millisecond", "run"] as const,
      ["run.output_throughput", 25, "token_per_second", "run"] as const,
      ["run.recovery", 1, "recovery", "run"] as const,
      ["llm.input_token.estimated", 4_000, "token", "run"] as const,
      ["file.upload.pipeline_duration", 250, "millisecond", "storage"] as const,
    ];
    for (const [
      index,
      [metric, quantity, unit, sourceType],
    ] of metrics.entries()) {
      await repository.createUsageEvent({
        id: `usage_runtime_${index}`,
        orgId: "org_default",
        workspaceId: "workspace_default",
        actorId: "user_dev_admin",
        sourceType,
        sourceId: `runtime_${index}`,
        metric,
        quantity,
        unit,
        metadata: {},
        createdAt,
      });
    }
    await repository.createUsageEvent({
      id: "usage_runtime_web",
      orgId: "org_default",
      actorId: "user_dev_admin",
      sourceType: "retrieval",
      sourceId: "web_runtime",
      metric: "web.search.request",
      quantity: 1,
      unit: "request",
      metadata: { latencyMs: 420 },
      createdAt,
    });
    await repository.createUsageEvent({
      id: "usage_runtime_object_store_failure",
      orgId: "org_default",
      actorId: "user_dev_admin",
      sourceType: "storage",
      sourceId: "file_safe_identifier",
      metric: "trace.span",
      quantity: 12,
      unit: "millisecond",
      metadata: {
        boundary: "object_store",
        operation: "get_content",
        outcome: "failure",
      },
      createdAt,
    });

    const summary = await summarizeProviderOperations({
      circuitBreaker: new ProviderCircuitBreaker(),
      now: "2026-07-16T12:05:00.000Z",
      options: {},
      orgId: "org_default",
      repository,
      routingPolicy: createProviderRoutingPolicy({}),
    });

    expect(summary.runtime).toMatchObject({
      contextInputTokensAverage: 4000,
      objectStoreFailureCount: 1,
      providerErrorCount: 5,
      queueWaitP95Ms: 35000,
      recoveryCount: 1,
      sseDisconnectCount: 3,
      sseReconnectCount: 2,
      timeToFirstTokenP95Ms: 12000,
      uploadPipelineAverageMs: 250,
      webRetrievalAverageMs: 420,
      outputThroughputAverage: 25,
    });
    expect(summary.alerts.map((alert) => alert.code)).toEqual(
      expect.arrayContaining([
        "provider_errors_recent",
        "object_store_failures_recent",
        "queue_wait_high",
        "sse_disconnects_recent",
        "time_to_first_token_high",
      ]),
    );
    expect(JSON.stringify(summary)).not.toContain("web_runtime");
    expect(JSON.stringify(summary)).not.toContain("usage_runtime");
  });
});

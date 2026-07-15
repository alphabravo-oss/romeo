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
});

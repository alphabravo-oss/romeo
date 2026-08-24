import { ProviderCircuitBreaker } from "@romeo/ai-runtime";
import { describe, expect, it, vi } from "vitest";

import { executeCompatibilityProviderRequest } from "./compatibility-provider-execution";

const primary = {
  kind: "openai-compatible" as const,
  providerId: "provider_primary",
  target: "primary",
};

describe("compatibility provider execution", () => {
  it("retries a retryable pre-output failure and records circuit recovery", async () => {
    const breaker = new ProviderCircuitBreaker({
      cooldownMs: 1_000,
      failureThreshold: 2,
    });
    const execute = vi
      .fn()
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValueOnce("ready");

    await expect(
      executeCompatibilityProviderRequest({
        candidates: [primary],
        circuitBreaker: breaker,
        execute,
        operation: "chat",
        retryAttempts: 1,
        retryBackoffMs: 0,
        timeoutMs: 1_000,
      }),
    ).resolves.toMatchObject({ retryAttempts: 1, value: "ready" });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(breaker.snapshot(primary.providerId)).toEqual({
      consecutiveFailures: 0,
      state: "closed",
    });
  });

  it("never retries or falls back after output has been observed", async () => {
    const execute = vi.fn(async (_target, _signal, markOutput) => {
      markOutput();
      throw { status: 503 };
    });
    await expect(
      executeCompatibilityProviderRequest({
        candidates: [
          primary,
          {
            kind: "openai-compatible",
            providerId: "provider_fallback",
            target: "fallback",
          },
        ],
        circuitBreaker: new ProviderCircuitBreaker(),
        execute,
        operation: "chat",
        retryAttempts: 2,
        retryBackoffMs: 0,
        timeoutMs: 1_000,
      }),
    ).rejects.toMatchObject({ errorCode: "provider_unavailable" });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("moves to an authorized fallback when the primary circuit is open", async () => {
    const breaker = new ProviderCircuitBreaker({
      cooldownMs: 60_000,
      failureThreshold: 1,
    });
    breaker.recordFailure(primary.providerId);
    const execute = vi.fn(async (target: string) => target);
    await expect(
      executeCompatibilityProviderRequest({
        candidates: [
          primary,
          {
            kind: "ollama",
            providerId: "provider_fallback",
            target: "fallback",
          },
        ],
        circuitBreaker: breaker,
        execute,
        operation: "chat",
        retryAttempts: 0,
        retryBackoffMs: 0,
        timeoutMs: 1_000,
      }),
    ).resolves.toMatchObject({
      fallbackUsed: true,
      target: "fallback",
      value: "fallback",
    });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("aborts a timed-out attempt and returns a sanitized timeout", async () => {
    const execute = vi.fn(() => new Promise<string>(() => undefined));
    const promise = executeCompatibilityProviderRequest({
      candidates: [primary],
      circuitBreaker: new ProviderCircuitBreaker(),
      execute,
      operation: "chat",
      retryAttempts: 0,
      retryBackoffMs: 0,
      timeoutMs: 5,
    });
    await expect(promise).rejects.toMatchObject({
      errorCode: "provider_timeout",
      retryable: true,
    });
    await expect(promise).rejects.not.toHaveProperty("secret");
  });
});

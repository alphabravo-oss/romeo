import { describe, expect, it, vi } from "vitest";

import { createRomeoApi, createRomeoApiRuntime } from "./api";
import { InMemoryRomeoRepository } from "./repositories/in-memory";
import type { ChatEventTransport } from "./services/chat-event-transport";
import type { QuotaCoordinator } from "./services/quota-coordination";
import type { RunEventTransport } from "./services/run-event-transport";
import { EnvironmentSecretResolver } from "./services/secret-resolver";
import { testEnv } from "./test-support/env";

describe("Romeo API runtime lifecycle", () => {
  it("keeps library-created APIs worker-free by default", () => {
    vi.useFakeTimers();
    try {
      const before = vi.getTimerCount();
      createRomeoApi(new InMemoryRomeoRepository(), { env: testEnv() });
      expect(vi.getTimerCount()).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts, stops, and drains each worker set idempotently", async () => {
    const runtime = createRomeoApiRuntime(new InMemoryRomeoRepository(), {
      env: testEnv(),
    });
    const scheduledStart = vi
      .spyOn(runtime.scheduledRuntimeWorkers!, "start")
      .mockImplementation(() => undefined);
    const scheduledStop = vi
      .spyOn(runtime.scheduledRuntimeWorkers!, "stop")
      .mockImplementation(() => undefined);
    const cleanupDrain = vi
      .spyOn(runtime.services.temporaryChatCleanup, "drain")
      .mockResolvedValue();
    const terminalDrain = vi
      .spyOn(runtime.services.runs, "drainTerminalOutboxWorker")
      .mockResolvedValue();
    const catalogDrain = vi
      .spyOn(runtime.services.providers, "drainCatalogSyncWorker")
      .mockResolvedValue();

    runtime.start();
    runtime.start();
    runtime.stop();
    runtime.stop();
    await runtime.drain();

    expect(scheduledStart).toHaveBeenCalledOnce();
    expect(scheduledStop).toHaveBeenCalledOnce();
    expect(cleanupDrain).toHaveBeenCalledOnce();
    expect(terminalDrain).toHaveBeenCalledOnce();
    expect(catalogDrain).toHaveBeenCalledOnce();
  });

  it("becomes unready before workers drain and recovers after restart", async () => {
    const runtime = createRomeoApiRuntime(new InMemoryRomeoRepository(), {
      env: testEnv(),
    });
    runtime.start();
    expect(
      (
        await runtime.app.request("/api/v1/readyz", undefined, {
          requestPeerAddress: "127.0.0.1",
        })
      ).status,
    ).toBe(200);

    runtime.stop();
    expect(
      (
        await runtime.app.request("/api/v1/readyz", undefined, {
          requestPeerAddress: "127.0.0.1",
        })
      ).status,
    ).toBe(503);

    runtime.start();
    expect(
      (
        await runtime.app.request("/api/v1/readyz", undefined, {
          requestPeerAddress: "127.0.0.1",
        })
      ).status,
    ).toBe(200);
    await runtime.close();
  });

  it("drains workers and closes realtime transports exactly once", async () => {
    const runEventsClose = vi.fn();
    const chatEventsClose = vi.fn();
    const quotaClose = vi.fn();
    const runtime = createRomeoApiRuntime(new InMemoryRomeoRepository(), {
      chatEventTransport: chatEventTransport(chatEventsClose),
      env: testEnv(),
      quotaCoordinator: quotaCoordinator(quotaClose),
      runEventTransport: runEventTransport(runEventsClose),
    });
    const cleanupDrain = vi
      .spyOn(runtime.services.temporaryChatCleanup, "drain")
      .mockResolvedValue();
    const terminalDrain = vi
      .spyOn(runtime.services.runs, "drainTerminalOutboxWorker")
      .mockResolvedValue();
    const catalogDrain = vi
      .spyOn(runtime.services.providers, "drainCatalogSyncWorker")
      .mockResolvedValue();
    runtime.start();
    const firstClose = runtime.close();
    const concurrentClose = runtime.close();
    expect(concurrentClose).toBe(firstClose);
    await Promise.all([firstClose, concurrentClose]);
    await runtime.close();

    expect(cleanupDrain).toHaveBeenCalledOnce();
    expect(terminalDrain).toHaveBeenCalledOnce();
    expect(catalogDrain).toHaveBeenCalledOnce();
    expect(runEventsClose).toHaveBeenCalledOnce();
    expect(chatEventsClose).toHaveBeenCalledOnce();
    expect(quotaClose).toHaveBeenCalledOnce();
  });

  it("closes process clients only after active work drains", async () => {
    let releaseDrain: (() => void) | undefined;
    const activeDrain = new Promise<void>((resolve) => {
      releaseDrain = resolve;
    });
    const runEventsClose = vi.fn();
    const runtime = createRomeoApiRuntime(new InMemoryRomeoRepository(), {
      env: testEnv(),
      runEventTransport: runEventTransport(runEventsClose),
    });
    vi.spyOn(runtime.services.temporaryChatCleanup, "drain").mockReturnValue(
      activeDrain,
    );

    runtime.start();
    const closing = runtime.close();
    await Promise.resolve();
    expect(runEventsClose).not.toHaveBeenCalled();

    releaseDrain?.();
    await closing;
    expect(runEventsClose).toHaveBeenCalledOnce();
  });

  it("constructs notification clients once across concurrent request scopes", async () => {
    const repository = new InMemoryRomeoRepository();
    const constructResendClient = vi.fn(() => ({
      emails: {
        send: vi.fn(async () => ({
          data: { id: "email_test" },
          error: null,
          headers: null,
        })),
      },
    }));
    const runtime = createRomeoApiRuntime(repository, {
      env: testEnv({
        NOTIFICATION_DELIVERY_DRIVER: "resend-email",
        NOTIFICATION_EMAIL_FROM: "notifications@romeo.test",
        NOTIFICATION_RESEND_API_KEY: "re_test",
      }),
      notificationResendClientFactory: constructResendClient,
      repositoryRequestScope: {
        runAsSystem: (work) => work(repository),
        runAsTenant: (_orgId, work) => work(repository),
      },
    });

    const responses = await Promise.all(
      Array.from({ length: 32 }, () =>
        runtime.app.request("/api/v1/workspaces"),
      ),
    );

    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(constructResendClient).toHaveBeenCalledOnce();
    await runtime.close();
  });

  it("shares provider circuit state across compatibility request scopes", async () => {
    const repository = new InMemoryRomeoRepository();
    const provider = await repository.getProvider("provider_openai_compatible");
    if (provider === undefined) throw new Error("Expected seeded provider.");
    provider.baseUrl = "https://api.example.test/v1";
    provider.credentialRef = "env://ROMEO_PROVIDER_API_KEY";
    const providerFetch = vi.fn(async (_input: RequestInfo | URL) =>
      Promise.resolve(new Response("unavailable", { status: 503 })),
    );
    const runtime = createRomeoApiRuntime(repository, {
      env: testEnv({
        MODEL_PROVIDER_CIRCUIT_COOLDOWN_MS: "60000",
        MODEL_PROVIDER_CIRCUIT_FAILURE_THRESHOLD: "1",
        MODEL_PROVIDER_RETRY_ATTEMPTS: "2",
      }),
      providerFetch,
      secretResolver: new EnvironmentSecretResolver({
        ROMEO_PROVIDER_API_KEY: "provider-test-key",
      }),
    });
    const request = () =>
      runtime.app.request("/api/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "model_openai_compatible_default",
          messages: [{ role: "user", content: "Bound this request." }],
        }),
      });

    const first = await request();
    const second = await request();

    expect(first.status).toBe(503);
    expect(second.status).toBe(503);
    expect(providerFetch).toHaveBeenCalledOnce();
    expect(await second.json()).toMatchObject({
      error: {
        code: "provider_unavailable",
        details: { circuitOpen: true, retryable: true },
      },
    });
    await runtime.close();
  });

  it("uses only an authorized configured fallback for compatibility inference", async () => {
    const repository = new InMemoryRomeoRepository();
    const providerUrls: string[] = [];
    const providerFetch = vi.fn(async (input: RequestInfo | URL) => {
      providerUrls.push(String(input));
      return Promise.resolve(
        new Response(
          `${JSON.stringify({
            message: { role: "assistant", content: "Fallback ready." },
            done: true,
          })}\n`,
        ),
      );
    });
    const runtime = createRomeoApiRuntime(repository, {
      env: testEnv({
        MODEL_PROVIDER_DISABLED_IDS: "provider_openai_compatible",
        MODEL_PROVIDER_FALLBACK_MODEL_ID: "model_ollama_default",
      }),
      providerFetch,
    });
    const response = await runtime.app.request("/api/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "model_openai_compatible_default",
        messages: [{ role: "user", content: "Use governed fallback." }],
      }),
    });
    const body = await response.json();
    const usage = await repository.listUsageEvents("org_default");

    expect(response.status).toBe(200);
    expect(body.choices[0].message.content).toBe("Fallback ready.");
    expect(providerFetch).toHaveBeenCalledOnce();
    expect(providerUrls[0]).toContain("localhost:11434");
    expect(
      usage.find((event) => event.metric === "run.completed")?.metadata,
    ).toMatchObject({
      effectiveModelId: "model_ollama_default",
      effectiveProviderId: "provider_ollama",
    });
    expect(await repository.listAuditLogs("org_default")).toContainEqual(
      expect.objectContaining({
        action: "model.request",
        metadata: expect.objectContaining({ providerId: "provider_ollama" }),
        resourceId: "model_ollama_default",
      }),
    );
    await runtime.close();
  });
});

function chatEventTransport(close: () => void): ChatEventTransport {
  return {
    close,
    async publish() {},
    async subscribe() {
      return () => undefined;
    },
  };
}

function runEventTransport(close: () => void): RunEventTransport {
  return {
    close,
    async publish() {},
    async subscribe() {
      return () => undefined;
    },
  };
}

function quotaCoordinator(close: () => void): QuotaCoordinator {
  return {
    close,
    async deleteBucket() {},
    async reserve() {
      return { allowed: true, reservations: [] };
    },
    async status() {
      return {
        checkedAt: new Date().toISOString(),
        configured: false,
        details: { failClosed: false, statusCode: "disabled" },
        driver: "disabled",
        enabled: false,
        healthy: null,
        keyPrefix: "test",
      };
    },
    async syncBucket() {},
  };
}

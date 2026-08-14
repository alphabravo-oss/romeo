import { describe, expect, it, vi } from "vitest";

import { createRomeoApi, createRomeoApiRuntime } from "./api";
import { InMemoryRomeoRepository } from "./repositories/in-memory";
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
    const cleanupStart = vi
      .spyOn(runtime.services.temporaryChatCleanup, "start")
      .mockImplementation(() => undefined);
    const cleanupStop = vi
      .spyOn(runtime.services.temporaryChatCleanup, "stop")
      .mockImplementation(() => undefined);
    const cleanupDrain = vi
      .spyOn(runtime.services.temporaryChatCleanup, "drain")
      .mockResolvedValue();
    const terminalStart = vi
      .spyOn(runtime.services.runs, "startTerminalOutboxWorker")
      .mockImplementation(() => undefined);
    const terminalStop = vi
      .spyOn(runtime.services.runs, "stopTerminalOutboxWorker")
      .mockImplementation(() => undefined);
    const terminalDrain = vi
      .spyOn(runtime.services.runs, "drainTerminalOutboxWorker")
      .mockResolvedValue();
    const catalogStart = vi
      .spyOn(runtime.services.providers, "startCatalogSyncWorker")
      .mockImplementation(() => undefined);
    const catalogStop = vi
      .spyOn(runtime.services.providers, "stopCatalogSyncWorker")
      .mockImplementation(() => undefined);
    const catalogDrain = vi
      .spyOn(runtime.services.providers, "drainCatalogSyncWorker")
      .mockResolvedValue();

    runtime.start();
    runtime.start();
    runtime.stop();
    runtime.stop();
    await runtime.drain();

    expect(cleanupStart).toHaveBeenCalledOnce();
    expect(terminalStart).toHaveBeenCalledOnce();
    expect(catalogStart).toHaveBeenCalledOnce();
    expect(cleanupStop).toHaveBeenCalledOnce();
    expect(terminalStop).toHaveBeenCalledOnce();
    expect(catalogStop).toHaveBeenCalledOnce();
    expect(cleanupDrain).toHaveBeenCalledOnce();
    expect(terminalDrain).toHaveBeenCalledOnce();
    expect(catalogDrain).toHaveBeenCalledOnce();
  });

  it("drains workers and closes realtime transports exactly once", async () => {
    const runtime = createRomeoApiRuntime(new InMemoryRomeoRepository(), {
      env: testEnv(),
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
    const runEventsClose = vi
      .spyOn(runtime.services.runs, "closeRunEventTransport")
      .mockImplementation(() => undefined);
    const chatEventsClose = vi
      .spyOn(runtime.services.chatEvents, "close")
      .mockImplementation(() => undefined);

    runtime.start();
    await runtime.close();
    await runtime.close();

    expect(cleanupDrain).toHaveBeenCalledOnce();
    expect(terminalDrain).toHaveBeenCalledOnce();
    expect(catalogDrain).toHaveBeenCalledOnce();
    expect(runEventsClose).toHaveBeenCalledOnce();
    expect(chatEventsClose).toHaveBeenCalledOnce();
  });
});

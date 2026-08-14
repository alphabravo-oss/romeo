import { afterEach, describe, expect, it, vi } from "vitest";

import { workerHealthChannel } from "./worker-health";
import { WorkerSupervisor } from "./worker-supervisor";

describe("background worker supervision", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("prevents overlapping iterations and resumes after completion", async () => {
    let release!: () => void;
    const first = new Promise<void>((resolve) => {
      release = resolve;
    });
    const work = vi
      .fn<() => Promise<void>>()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce();
    const supervisor = new WorkerSupervisor("test_worker");

    supervisor.run(work);
    supervisor.run(work);
    expect(work).toHaveBeenCalledOnce();
    release();
    await first;
    await new Promise((resolve) => setTimeout(resolve, 0));
    supervisor.run(work);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(work).toHaveBeenCalledTimes(2);
  });

  it("contains rejected iterations without exposing raw error messages", async () => {
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const supervisor = new WorkerSupervisor("test_worker");

    supervisor.run(async () => {
      throw new Error("credential=secret-value");
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(error).toHaveBeenCalledWith("background worker iteration failed", {
      worker: "test_worker",
      errorKind: "Error",
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain("secret-value");
  });

  it("contains synchronous throws and permits the next iteration", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const work = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => {
        throw new Error("synchronous secret-value");
      })
      .mockResolvedValueOnce();
    const supervisor = new WorkerSupervisor("test_worker");

    expect(() => supervisor.run(work)).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    supervisor.run(work);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(work).toHaveBeenCalledTimes(2);
    expect(supervisor.running).toBe(false);
  });

  it("backs off failed recurring work with bounded deterministic jitter", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const work = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("first"))
      .mockRejectedValueOnce(new Error("second"))
      .mockResolvedValue();
    const supervisor = new WorkerSupervisor("backoff_worker", {
      random: () => 0.5,
    });

    supervisor.start(work, {
      intervalMs: 100,
      maxBackoffMs: 1_000,
      jitterRatio: 0.2,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(work).toHaveBeenCalledTimes(1);
    expect(supervisor.snapshot()).toMatchObject({
      state: "backoff",
      consecutiveFailures: 1,
      failureCount: 1,
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(work).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(199);
    expect(work).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(work).toHaveBeenCalledTimes(3);
    expect(supervisor.snapshot()).toMatchObject({
      state: "idle",
      consecutiveFailures: 0,
      successCount: 1,
    });
    supervisor.stop();
  });

  it("aborts scheduled work and drains the active iteration", async () => {
    let observedSignal: AbortSignal | undefined;
    const supervisor = new WorkerSupervisor("drain_worker");
    supervisor.start(
      (signal) =>
        new Promise<void>((resolve) => {
          observedSignal = signal;
          signal.addEventListener("abort", () => resolve(), { once: true });
        }),
      { intervalMs: 100 },
    );

    supervisor.stop();
    await supervisor.drain();

    expect(observedSignal?.aborted).toBe(true);
    expect(supervisor.snapshot()).toMatchObject({
      running: false,
      state: "stopped",
    });
  });

  it("publishes metadata-only schedule, health, and lease observations", async () => {
    const observations: unknown[] = [];
    const handler = (message: unknown) => observations.push(message);
    workerHealthChannel.subscribe(handler);
    try {
      const supervisor = new WorkerSupervisor("observable_worker");
      supervisor.recordLease({ claimed: true, count: 2, lagMs: 47 });
      supervisor.run(async () => {
        throw new Error("credential=must-not-appear");
      });
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(supervisor.snapshot()).toMatchObject({
        leaseClaimCount: 2,
        leaseLagMs: 47,
        failureCount: 1,
      });
      expect(JSON.stringify(observations)).not.toContain("must-not-appear");
    } finally {
      workerHealthChannel.unsubscribe(handler);
    }
  });
});

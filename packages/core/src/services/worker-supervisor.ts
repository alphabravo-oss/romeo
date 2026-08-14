import {
  publishWorkerHealth,
  type WorkerHealthSnapshot,
} from "./worker-health";

export interface WorkerScheduleOptions {
  intervalMs: number;
  maxBackoffMs?: number;
  jitterRatio?: number;
}

interface WorkerSupervisorOptions {
  now?: () => number;
  random?: () => number;
}

export class WorkerSupervisor {
  private active: Promise<unknown> | undefined;
  private controller: AbortController | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private health: WorkerHealthSnapshot;

  constructor(
    private readonly name: string,
    private readonly options: WorkerSupervisorOptions = {},
  ) {
    this.health = initialHealth(name);
    this.publish();
  }

  run(work: (signal: AbortSignal) => Promise<unknown>): void {
    if (this.active !== undefined) {
      this.update({ skippedOverlapCount: this.health.skippedOverlapCount + 1 });
      return;
    }
    this.execute(work);
  }

  start(
    work: (signal: AbortSignal) => Promise<unknown>,
    schedule: WorkerScheduleOptions,
  ): void {
    if (this.timer !== undefined || this.active !== undefined) return;
    this.stopped = false;
    const runScheduled = (scheduledAt = this.now()) => {
      this.timer = undefined;
      this.execute(work, scheduledAt, (failed) => {
        if (this.stopped) return;
        const delay = this.nextDelay(schedule, failed);
        this.schedule(runScheduled, delay);
      });
    };
    runScheduled();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.controller?.abort();
    this.update({ state: "stopped", nextRunAt: undefined });
  }

  async drain(): Promise<void> {
    await this.active;
  }

  recordLease(input: {
    claimed: boolean;
    count?: number;
    lagMs?: number;
  }): void {
    const count = Math.max(1, Math.floor(input.count ?? 1));
    this.update({
      leaseClaimCount:
        this.health.leaseClaimCount + (input.claimed ? count : 0),
      leaseMissCount: this.health.leaseMissCount + (input.claimed ? 0 : count),
      leaseLagMs: Math.max(0, Math.floor(input.lagMs ?? 0)),
    });
  }

  snapshot(): WorkerHealthSnapshot {
    return { ...this.health };
  }

  private execute(
    work: (signal: AbortSignal) => Promise<unknown>,
    scheduledAt = this.now(),
    settled?: (failed: boolean) => void,
  ): void {
    const startedAt = this.now();
    this.controller = new AbortController();
    this.update({
      state: "running",
      running: true,
      iterationCount: this.health.iterationCount + 1,
      scheduleLagMs: Math.max(0, startedAt - scheduledAt),
      lastStartedAt: iso(startedAt),
      nextRunAt: undefined,
    });
    // A worker callback can throw synchronously before returning its promise.
    // Normalize that into the same supervised rejection path while preserving
    // the current immediate-start behavior used by each worker's start hook.
    let iteration: Promise<unknown>;
    try {
      iteration = work(this.controller.signal);
    } catch (error) {
      iteration = Promise.reject(error);
    }
    let failed = false;
    const active = iteration
      .catch((error: unknown) => {
        failed = true;
        reportBackgroundFailure(this.name, error);
      })
      .finally(() => {
        if (this.active === active) {
          this.active = undefined;
          this.controller = undefined;
        }
        const completedAt = this.now();
        this.update({
          state: this.stopped ? "stopped" : failed ? "backoff" : "idle",
          running: false,
          consecutiveFailures: failed ? this.health.consecutiveFailures + 1 : 0,
          successCount: this.health.successCount + (failed ? 0 : 1),
          failureCount: this.health.failureCount + (failed ? 1 : 0),
          lastCompletedAt: iso(completedAt),
          ...(failed
            ? { lastFailureAt: iso(completedAt) }
            : { lastSuccessAt: iso(completedAt) }),
        });
        settled?.(failed);
      });
    this.active = active;
  }

  private nextDelay(schedule: WorkerScheduleOptions, failed: boolean): number {
    const intervalMs = Math.max(1, Math.floor(schedule.intervalMs));
    const maxBackoffMs = Math.max(
      intervalMs,
      Math.floor(schedule.maxBackoffMs ?? intervalMs * 16),
    );
    const base = failed
      ? Math.min(
          maxBackoffMs,
          intervalMs * 2 ** Math.max(0, this.health.consecutiveFailures - 1),
        )
      : intervalMs;
    const jitterRatio = Math.min(1, Math.max(0, schedule.jitterRatio ?? 0.2));
    const random = this.options.random?.() ?? Math.random();
    return Math.max(
      1,
      Math.floor(base + base * jitterRatio * (random * 2 - 1)),
    );
  }

  private schedule(
    callback: (scheduledAt: number) => void,
    delayMs: number,
  ): void {
    const nextRun = this.now() + delayMs;
    this.update({ nextRunAt: iso(nextRun) });
    this.timer = setTimeout(() => callback(nextRun), delayMs);
    this.timer.unref?.();
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private update(patch: Partial<WorkerHealthSnapshot>): void {
    this.health = { ...this.health, ...patch };
    this.publish();
  }

  private publish(): void {
    publishWorkerHealth(this.health);
  }

  get running(): boolean {
    return this.active !== undefined;
  }
}

function initialHealth(worker: string): WorkerHealthSnapshot {
  return {
    worker,
    state: "idle",
    running: false,
    consecutiveFailures: 0,
    iterationCount: 0,
    successCount: 0,
    failureCount: 0,
    skippedOverlapCount: 0,
    leaseClaimCount: 0,
    leaseMissCount: 0,
    scheduleLagMs: 0,
    leaseLagMs: 0,
  };
}

function iso(value: number): string {
  return new Date(value).toISOString();
}

export function reportBackgroundFailure(name: string, error: unknown): void {
  console.error("background worker iteration failed", {
    worker: name,
    errorKind: safeErrorKind(error),
  });
}

function safeErrorKind(error: unknown): string {
  if (error instanceof TypeError) return "TypeError";
  if (error instanceof RangeError) return "RangeError";
  if (error instanceof Error) return "Error";
  return "NonErrorThrow";
}

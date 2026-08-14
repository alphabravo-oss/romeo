import type { SseStreamObserver } from "@romeo/ai-runtime";

export interface RunSseOperationalSnapshot {
  activeStreams: number;
  bufferedBytesHighWater: number;
  connectionCount: number;
  cursorQueryCount: number;
  cursorQueryRowCount: number;
  heartbeatFailureCount: number;
  lookbackSeconds: number;
  notifierLagAverageMs: number;
  notifierLagP95Ms: number;
  notifierUnavailableCount: number;
  observationScope: "process";
  reconnectCount: number;
  replayedRowCount: number;
  slowConsumerDropCount: number;
  terminalCloseLatencyAverageMs: number;
  terminalCloseLatencyP95Ms: number;
}

export interface RunEventReplayObserver {
  onCursorQuery(rows: number): void;
  onNotifierLag(ms: number): void;
  onNotifierUnavailable(): void;
  onReplayedRows(rows: number): void;
}

interface TimedValue {
  at: number;
  value: number;
}

const defaultLookbackMs = 15 * 60 * 1_000;
const maxSamplesPerMetric = 4_096;

/**
 * Process-local, metadata-only SSE health. Durable usage events remain the
 * source for fleet-wide reconnect/disconnect counts; this fills the live
 * transport details that cannot be reconstructed from persisted run data.
 */
export class RunSseObservability {
  private activeStreams = 0;
  private readonly counts = new Map<string, number[]>();
  private readonly values = new Map<string, TimedValue[]>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly lookbackMs = defaultLookbackMs,
  ) {}

  streamObserver(reconnect: boolean): SseStreamObserver {
    let active = false;
    return {
      onOpen: () => {
        if (active) return;
        active = true;
        this.activeStreams += 1;
        this.increment("connection");
        if (reconnect) this.increment("reconnect");
      },
      onBufferedBytes: (bytes) => this.sample("buffered_bytes", bytes),
      onHeartbeatFailure: () => this.increment("heartbeat_failure"),
      onSlowConsumerDrop: () => this.increment("slow_consumer_drop"),
      onTerminalCloseLatency: (ms) => this.sample("terminal_close_latency", ms),
      onClose: () => {
        if (!active) return;
        active = false;
        this.activeStreams = Math.max(0, this.activeStreams - 1);
      },
    };
  }

  replayObserver(reconnect: boolean): RunEventReplayObserver {
    return {
      onCursorQuery: (rows) => {
        this.increment("cursor_query");
        this.sample("cursor_query_rows", rows);
      },
      onNotifierLag: (ms) => this.sample("notifier_lag", ms),
      onNotifierUnavailable: () => this.increment("notifier_unavailable"),
      onReplayedRows: (rows) => {
        if (reconnect && rows > 0) this.sample("replayed_rows", rows);
      },
    };
  }

  snapshot(): RunSseOperationalSnapshot {
    const now = this.now();
    const notifierLag = this.recentValues("notifier_lag", now);
    const terminalCloseLatency = this.recentValues(
      "terminal_close_latency",
      now,
    );
    return {
      activeStreams: this.activeStreams,
      bufferedBytesHighWater: maximum(this.recentValues("buffered_bytes", now)),
      connectionCount: this.recentCount("connection", now),
      cursorQueryCount: this.recentCount("cursor_query", now),
      cursorQueryRowCount: sum(this.recentValues("cursor_query_rows", now)),
      heartbeatFailureCount: this.recentCount("heartbeat_failure", now),
      lookbackSeconds: Math.floor(this.lookbackMs / 1_000),
      notifierLagAverageMs: average(notifierLag),
      notifierLagP95Ms: percentile(notifierLag, 0.95),
      notifierUnavailableCount: this.recentCount("notifier_unavailable", now),
      observationScope: "process",
      reconnectCount: this.recentCount("reconnect", now),
      replayedRowCount: sum(this.recentValues("replayed_rows", now)),
      slowConsumerDropCount: this.recentCount("slow_consumer_drop", now),
      terminalCloseLatencyAverageMs: average(terminalCloseLatency),
      terminalCloseLatencyP95Ms: percentile(terminalCloseLatency, 0.95),
    };
  }

  private increment(metric: string): void {
    const values = this.counts.get(metric) ?? [];
    values.push(this.now());
    trimToLimit(values);
    this.counts.set(metric, values);
  }

  private sample(metric: string, value: number): void {
    if (!Number.isFinite(value)) return;
    const values = this.values.get(metric) ?? [];
    values.push({ at: this.now(), value: Math.max(0, value) });
    trimToLimit(values);
    this.values.set(metric, values);
  }

  private recentCount(metric: string, now: number): number {
    const values = this.counts.get(metric) ?? [];
    const recent = values.filter((at) => at >= now - this.lookbackMs);
    this.counts.set(metric, recent);
    return recent.length;
  }

  private recentValues(metric: string, now: number): number[] {
    const values = this.values.get(metric) ?? [];
    const recent = values.filter(({ at }) => at >= now - this.lookbackMs);
    this.values.set(metric, recent);
    return recent.map(({ value }) => value);
  }
}

function trimToLimit<T>(values: T[]): void {
  if (values.length > maxSamplesPerMetric)
    values.splice(0, values.length - maxSamplesPerMetric);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

function maximum(values: number[]): number {
  return values.length === 0 ? 0 : Math.max(...values);
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return (
    sorted[
      Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)
    ] ?? 0
  );
}

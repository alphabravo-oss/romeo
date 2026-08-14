export type IdempotencyOutcome =
  | "owner"
  | "replay"
  | "conflict"
  | "in_progress"
  | "failed";
export type ObservedIdempotentOperation =
  | "images.generate"
  | "runs.start"
  | "exports.execute"
  | "compare.sessions.start"
  | "compute.jobs.create"
  | "media.jobs.create"
  | "table.exports.create";

export class IdempotencyUsageStore {
  private readonly counts = new Map<string, number>();

  record(
    operation: ObservedIdempotentOperation,
    outcome: IdempotencyOutcome,
  ): void {
    const key = `${operation}\u001f${outcome}`;
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }

  snapshot() {
    return {
      observationScope: "process" as const,
      outcomes: [...this.counts.entries()]
        .map(([key, count]) => {
          const [operation = "unknown", outcome = "failed"] =
            key.split("\u001f");
          return {
            operation: operation as ObservedIdempotentOperation,
            outcome: outcome as IdempotencyOutcome,
            count,
          };
        })
        .sort(
          (left, right) =>
            left.operation.localeCompare(right.operation) ||
            left.outcome.localeCompare(right.outcome),
        ),
    };
  }

  reset(): void {
    this.counts.clear();
  }
}

export const idempotencyUsageStore = new IdempotencyUsageStore();

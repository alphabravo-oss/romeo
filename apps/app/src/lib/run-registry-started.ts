import type { QueryClient } from "@tanstack/react-query";

import { stampAssistantModel } from "./run-registry-messages";
import type { TrackedRun } from "./run-registry-types";

export function applyRunStarted(input: {
  data: unknown;
  publish: (patch: Partial<TrackedRun>) => void;
  queryClient: QueryClient;
  run: TrackedRun;
  startWaitTicker: (run: TrackedRun) => void;
}): void {
  const record =
    typeof input.data === "object" && input.data !== null
      ? (input.data as Record<string, unknown>)
      : {};
  const modelId =
    typeof record.modelId === "string" && record.modelId.length > 0
      ? record.modelId
      : undefined;
  if (modelId !== undefined) {
    input.run.modelId = modelId;
    stampAssistantModel(input.queryClient, input.run, modelId);
    input.publish({ modelId });
  }
  const streamTimeoutMs = boundedPositiveNumber(record.streamTimeoutMs, 60_000);
  const maxRetries = Math.floor(boundedNonNegativeNumber(record.maxRetries, 1));
  input.run.timing.waitAttemptStartedAt = Date.now();
  input.publish({
    wait: {
      attempt: 1,
      elapsedSeconds: 0,
      hasContent: false,
      maxAttempts: maxRetries + 1,
      phase: "waiting",
      streamTimeoutMs,
    },
  });
  input.startWaitTicker(input.run);
}

function boundedPositiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function boundedNonNegativeNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

import {
  countsAgainstProviderHealth,
  normalizeProviderRetryPolicy,
  ProviderCircuitBreaker,
  retryDelay,
} from "@romeo/ai-runtime";
import {
  normalizeProviderError,
  ProviderNormalizedRequestError,
  type ProviderKind,
  type ProviderRequestOperation,
} from "@romeo/providers";

import { ApiError } from "../errors";

export interface CompatibilityProviderCandidate<T> {
  disabled?: boolean;
  kind: ProviderKind;
  providerId: string;
  target: T;
}

export interface CompatibilityProviderExecutionResult<T, R> {
  fallbackUsed: boolean;
  retryAttempts: number;
  target: T;
  value: R;
}

export async function executeCompatibilityProviderRequest<T, R>(input: {
  candidates: readonly [
    CompatibilityProviderCandidate<T>,
    ...CompatibilityProviderCandidate<T>[],
  ];
  circuitBreaker: ProviderCircuitBreaker;
  execute(target: T, signal: AbortSignal, markOutput: () => void): Promise<R>;
  operation: ProviderRequestOperation;
  retryBackoffMs: number;
  retryAttempts: number;
  signal?: AbortSignal;
  timeoutMs: number;
}): Promise<CompatibilityProviderExecutionResult<T, R>> {
  const retryPolicy = normalizeProviderRetryPolicy({
    backoffMs: input.retryBackoffMs,
    maxRetries: input.retryAttempts,
  });
  let retryAttempts = 0;
  let lastFailure: unknown;
  for (const [candidateIndex, candidate] of input.candidates.entries()) {
    if (input.signal?.aborted === true)
      throw cancelledFailure(candidate.kind, input.operation);
    if (candidate.disabled === true) {
      lastFailure = unavailableFailure(true);
      continue;
    }
    const circuit = input.circuitBreaker.beforeAttempt(candidate.providerId);
    if (circuit.state === "open") {
      lastFailure = unavailableFailure(true);
      continue;
    }

    for (let attempt = 0; attempt <= retryPolicy.maxRetries; attempt += 1) {
      if (
        attempt > 0 &&
        input.circuitBreaker.beforeAttempt(candidate.providerId).state ===
          "open"
      )
        break;
      let emittedOutput = false;
      const runtime = requestRuntime(input.signal, input.timeoutMs);
      try {
        const value = await runtime.wait(
          input.execute(candidate.target, runtime.signal, () => {
            emittedOutput = true;
          }),
        );
        input.circuitBreaker.recordSuccess(candidate.providerId);
        return {
          fallbackUsed: candidateIndex > 0,
          retryAttempts,
          target: candidate.target,
          value,
        };
      } catch (error) {
        if (isAborted(input.signal))
          throw cancelledFailure(candidate.kind, input.operation);
        const normalized = normalizeProviderError(
          candidate.kind,
          runtime.timedOut() ? timeoutFailure() : error,
          input.operation,
        );
        if (countsAgainstProviderHealth(normalized.category))
          input.circuitBreaker.recordFailure(candidate.providerId);
        lastFailure = normalized;
        if (
          !emittedOutput &&
          normalized.retryable &&
          attempt < retryPolicy.maxRetries
        ) {
          retryAttempts += 1;
          await retryDelay(retryPolicy.backoffMs, input.signal).catch(() => {
            throw cancelledFailure(candidate.kind, input.operation);
          });
          continue;
        }
        if (!emittedOutput && normalized.retryable) break;
        throw normalized;
      } finally {
        runtime.clear();
      }
    }
  }
  throw lastFailure ?? unavailableFailure(false);
}

function requestRuntime(parent: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => controller.abort(parent?.reason);
  parent?.addEventListener("abort", abortFromParent, { once: true });
  if (parent?.aborted === true) abortFromParent();
  const timeout = setTimeout(
    () => {
      timedOut = true;
      controller.abort();
    },
    Math.max(1, bounded(timeoutMs)),
  );
  timeout.unref?.();
  const aborted = new Promise<never>((_resolve, reject) => {
    const rejectAbort = () =>
      reject(timedOut ? timeoutFailure() : { name: "AbortError" });
    if (controller.signal.aborted) rejectAbort();
    else
      controller.signal.addEventListener("abort", rejectAbort, {
        once: true,
      });
  });
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    wait<T>(execution: Promise<T>): Promise<T> {
      return Promise.race([execution, aborted]);
    },
    clear() {
      clearTimeout(timeout);
      parent?.removeEventListener("abort", abortFromParent);
    },
  };
}

function cancelledFailure(
  kind: ProviderKind,
  operation: ProviderRequestOperation,
) {
  return new ProviderNormalizedRequestError(
    normalizeProviderError(kind, { name: "AbortError" }, operation),
  );
}

function timeoutFailure() {
  return { name: "TimeoutError" };
}

function unavailableFailure(circuitOpen: boolean) {
  return new ApiError(
    "provider_unavailable",
    "The model provider is temporarily unavailable.",
    503,
    { category: "unavailable", circuitOpen, retryable: true },
  );
}

function bounded(value: number): number {
  return Number.isInteger(value) && value > 0 ? value : 0;
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

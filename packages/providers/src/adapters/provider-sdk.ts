import OpenAI from "openai";
import { Ollama } from "ollama";

import { normalizeProviderError } from "../error-normalization";
import type {
  ProviderInstance,
  ProviderKind,
  ProviderNormalizedError,
  ProviderRequestOperation,
} from "../types";

export function createOpenAiClient(
  provider: Pick<ProviderInstance, "baseUrl">,
  apiKey: string | undefined,
  fetchImpl: typeof fetch | undefined,
  timeoutMs?: number,
): OpenAI {
  return new OpenAI({
    apiKey: apiKey ?? "romeo-no-credential-required",
    baseURL: provider.baseUrl.replace(/\/$/u, ""),
    maxRetries: 0,
    ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }),
    ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
  });
}

export function createOllamaClient(
  provider: Pick<ProviderInstance, "baseUrl">,
  options?: {
    apiKey?: string;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
    timeoutMs?: number;
  },
): Ollama {
  const baseFetch = options?.fetchImpl ?? fetch;
  const sdkFetch =
    options?.signal === undefined && options?.timeoutMs === undefined
      ? baseFetch
      : withRequestControls(baseFetch, options);
  return new Ollama({
    host: provider.baseUrl.replace(/\/$/u, ""),
    fetch: sdkFetch,
    ...(options?.apiKey === undefined
      ? {}
      : { headers: { authorization: `Bearer ${options.apiKey}` } }),
  });
}

export function normalizeProviderSdkError(
  caught: unknown,
  provider: ProviderKind,
  operation: ProviderRequestOperation = "chat",
): ProviderNormalizedError {
  return normalizeProviderError(provider, caught, operation);
}

export class ProviderSdkRequestError extends Error {
  readonly status: number | undefined;
  readonly category: ProviderNormalizedError["category"];
  readonly code: ProviderNormalizedError["code"];
  readonly errorCode: ProviderNormalizedError["errorCode"];
  readonly errorType: ProviderNormalizedError["errorType"];
  readonly operation: ProviderRequestOperation;
  readonly retryable: boolean;

  constructor(
    readonly provider: ProviderKind,
    caught: unknown,
    operation: ProviderRequestOperation = "chat",
  ) {
    const normalized = normalizeProviderError(provider, caught, operation);
    super(normalized.safeMessage);
    this.name = "ProviderSdkRequestError";
    this.category = normalized.category;
    this.code = normalized.code;
    this.errorCode = normalized.errorCode;
    this.errorType = normalized.errorType;
    this.operation = normalized.operation;
    this.retryable = normalized.retryable;
    this.status = normalized.status;
  }
}

function withRequestControls(
  fetchImpl: typeof fetch,
  options: { signal?: AbortSignal; timeoutMs?: number },
): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController();
    const signals = [init?.signal, options.signal, controller.signal].filter(
      (signal): signal is AbortSignal => signal !== undefined,
    );
    const timeout =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(() => controller.abort(), options.timeoutMs);
    const signal =
      signals.length === 1 ? signals[0]! : AbortSignal.any(signals);
    try {
      return await fetchImpl(input, {
        ...init,
        signal,
      });
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  };
}

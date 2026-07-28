import OpenAI from "openai";
import { Ollama } from "ollama";

import type { ProviderInstance } from "../types";

export function createOpenAiClient(
  provider: Pick<ProviderInstance, "baseUrl">,
  apiKey: string | undefined,
  fetchImpl: typeof fetch | undefined,
): OpenAI {
  return new OpenAI({
    apiKey: apiKey ?? "romeo-no-credential-required",
    baseURL: provider.baseUrl.replace(/\/$/u, ""),
    maxRetries: 0,
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

export function normalizeProviderSdkError(caught: unknown, provider: string) {
  if (caught instanceof Error && caught.name === "AbortError") return caught;
  if (typeof caught === "object" && caught !== null && "errorCode" in caught)
    return caught;
  const status =
    typeof caught === "object" &&
    caught !== null &&
    "status" in caught &&
    typeof caught.status === "number"
      ? caught.status
      : undefined;
  return {
    errorCode:
      status === undefined ? "provider_stream_error" : "provider_http_error",
    errorType:
      status === undefined
        ? `${provider}_sdk_error`
        : `${provider}_http_${status}`,
  };
}

export class ProviderSdkRequestError extends Error {
  readonly status: number | undefined;

  constructor(
    readonly provider: string,
    caught: unknown,
  ) {
    super(`${provider} provider request failed.`, { cause: caught });
    this.name = "ProviderSdkRequestError";
    this.status = providerSdkStatus(caught);
  }
}

function providerSdkStatus(caught: unknown): number | undefined {
  return typeof caught === "object" &&
    caught !== null &&
    "status" in caught &&
    typeof caught.status === "number"
    ? caught.status
    : undefined;
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

import { createClient, type Client } from "../generated/query/client/index";
import { RomeoApiError } from "../errors";
import type { ApiErrorEnvelope, RomeoClientOptions } from "./types";
import { adaptGeneratedFetch } from "./generated-transport";

export type GeneratedQueryClient = Client;

/**
 * Creates an isolated client for generated TanStack Query option factories.
 * Server callers must create one per request; browser callers should use the
 * configured singleton exported by `runtime/browser`.
 */
export function createGeneratedQueryClient(
  options: RomeoClientOptions,
): GeneratedQueryClient {
  const client = createClient({
    auth: options.apiKey,
    baseUrl: apiBaseUrl(options.baseUrl),
    fetch: adaptGeneratedFetch(options.fetchImpl ?? globalThis.fetch),
    responseStyle: "fields",
    throwOnError: true,
  });

  client.interceptors.error.use((error, response) => {
    if (error instanceof RomeoApiError) return error;
    if (!isApiErrorEnvelope(error)) return error;
    return new RomeoApiError(
      error.error.message,
      response?.status ?? 500,
      error,
    );
  });

  return client;
}

function apiBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/u, "");
  return normalized.endsWith("/api/v1") ? normalized : `${normalized}/api/v1`;
}

function isApiErrorEnvelope(value: unknown): value is ApiErrorEnvelope {
  if (typeof value !== "object" || value === null || !("error" in value))
    return false;
  const error = value.error;
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    "message" in error &&
    typeof error.message === "string" &&
    "request_id" in error &&
    typeof error.request_id === "string"
  );
}

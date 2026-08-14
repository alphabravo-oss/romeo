import { createClient, type Client } from "../generated/sdk/client";
import { RomeoApiError } from "../errors";
import type { ApiErrorEnvelope, RomeoClientOptions } from "./types";
import { adaptGeneratedFetch } from "./generated-transport";

export type GeneratedApiClient = Client;

export function createGeneratedClient(options: RomeoClientOptions): Client {
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

export function unwrapEnvelope<T>(envelope: { data: T }): T {
  return envelope.data;
}

export async function unwrapGeneratedData<T>(
  request: Promise<{ data: T }>,
): Promise<T> {
  return (await request).data;
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

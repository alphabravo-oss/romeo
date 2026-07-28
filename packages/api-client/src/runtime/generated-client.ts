import { createClient, type Client } from "../generated/sdk/client";
import { RomeoApiError } from "../errors";
import type { ApiErrorEnvelope, RomeoClientOptions } from "./types";

export type GeneratedApiClient = Client;

export function createGeneratedClient(options: RomeoClientOptions): Client {
  const client = createClient({
    auth: options.apiKey,
    baseUrl: apiBaseUrl(options.baseUrl),
    fetch: adaptFetch(options.fetchImpl ?? globalThis.fetch),
    responseStyle: "data",
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

function adaptFetch(fetchImpl: typeof fetch): typeof fetch {
  return async (input, init) => {
    if (!(input instanceof Request)) return fetchImpl(input, init);

    const body = ["GET", "HEAD"].includes(input.method)
      ? undefined
      : await input.clone().text();
    return fetchImpl(input.url, {
      ...(body === undefined || body === "" ? {} : { body }),
      cache: input.cache,
      credentials: input.credentials,
      headers: Object.fromEntries(input.headers.entries()),
      integrity: input.integrity,
      keepalive: input.keepalive,
      method: input.method,
      mode: input.mode,
      redirect: input.redirect,
      referrer: input.referrer,
      referrerPolicy: input.referrerPolicy,
      signal: input.signal,
    });
  };
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

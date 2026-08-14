import { client as queryClient } from "../generated/query";
import { client as sdkClient } from "../generated/sdk";
import { RomeoApiError } from "../errors";
import { adaptGeneratedFetch } from "./generated-transport";
import type { ApiErrorEnvelope } from "./types";

type GeneratedClient = typeof sdkClient;

export type BrowserQueryClient = typeof queryClient;

const configuredClients = new WeakSet<GeneratedClient>();

export interface BrowserClientRuntimeOptions {
  onUnauthorized?: () => void;
}

export function configureBrowserApiClients(
  options: BrowserClientRuntimeOptions = {},
): void {
  configureGeneratedClient(sdkClient, options);
  configureGeneratedClient(queryClient, options);
}

export function getBrowserQueryClient(): BrowserQueryClient {
  configureBrowserApiClients();
  return queryClient;
}

export function configureGeneratedClient(
  client: GeneratedClient,
  options: BrowserClientRuntimeOptions = {},
): void {
  if (configuredClients.has(client)) return;
  configuredClients.add(client);

  configureSameOriginTransport(client);

  client.interceptors.request.use((request) => {
    if (request.headers.has("x-request-id")) return request;
    const headers = new Headers(request.headers);
    headers.set("x-request-id", crypto.randomUUID());
    return new Request(request, { headers });
  });

  client.interceptors.response.use(async (response) => {
    if (response.ok) return response;

    if (response.status === 401) {
      (options.onUnauthorized ?? navigateToLogin)();
    }

    const body = (await response
      .clone()
      .json()
      .catch(() => undefined)) as unknown;
    if (isApiErrorEnvelope(body)) {
      throw new RomeoApiError(body.error.message, response.status, body);
    }
    return response;
  });
}

function configureSameOriginTransport(client: GeneratedClient): void {
  const config = client.getConfig();
  const baseUrl = config.baseUrl ?? "/api/v1";
  if (/^https?:\/\//u.test(baseUrl)) return;

  const origin =
    typeof window === "undefined"
      ? "http://romeo.local"
      : window.location.origin;
  client.setConfig({
    baseUrl: new URL(baseUrl, origin).toString().replace(/\/$/u, ""),
    fetch: adaptGeneratedFetch(
      (input, init) => globalThis.fetch(input, init),
      (request) => {
        const url = new URL(request.url);
        return `${url.pathname}${url.search}`;
      },
    ),
  });
}

function navigateToLogin(): void {
  if (typeof window === "undefined" || window.location.pathname === "/login")
    return;
  const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  window.location.assign(`/login?returnTo=${encodeURIComponent(returnTo)}`);
}

function isApiErrorEnvelope(body: unknown): body is ApiErrorEnvelope {
  if (typeof body !== "object" || body === null || !("error" in body))
    return false;
  const error = body.error;
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

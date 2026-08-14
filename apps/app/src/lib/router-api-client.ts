import { getBrowserQueryClient } from "@romeo/api-client/runtime/browser";
import {
  createGeneratedQueryClient,
  type GeneratedQueryClient,
} from "@romeo/api-client/runtime/generated-query-client";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

const forwardedRequestHeaders = [
  "accept-language",
  "authorization",
  "cookie",
  "x-request-id",
] as const;

export const getRouterApiClient = createIsomorphicFn()
  .client(() => getBrowserQueryClient())
  .server(() => createRequestApiClient(getRequest()));

export function createRequestApiClient(request: Request): GeneratedQueryClient {
  const origin = new URL(request.url).origin;
  const inheritedHeaders = new Headers();
  for (const name of forwardedRequestHeaders) {
    const value = request.headers.get(name);
    if (value !== null) inheritedHeaders.set(name, value);
  }

  return createGeneratedQueryClient({
    baseUrl: origin,
    fetchImpl: async (input, init) => {
      const targetUrl = new URL(
        input instanceof Request ? input.url : input.toString(),
        origin,
      );
      if (targetUrl.origin !== origin) {
        throw new Error("Refused to forward request credentials cross-origin");
      }
      const headers = new Headers(
        input instanceof Request ? input.headers : init?.headers,
      );
      inheritedHeaders.forEach((value, name) => {
        if (!headers.has(name)) headers.set(name, value);
      });
      if (input instanceof Request) {
        return globalThis.fetch(new Request(input, { headers }), init);
      }
      return globalThis.fetch(new Request(targetUrl, { ...init, headers }));
    },
  });
}

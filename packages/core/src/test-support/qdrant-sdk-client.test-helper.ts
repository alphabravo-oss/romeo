import { QdrantClientUnexpectedResponseError } from "@qdrant/js-client-rest";

import type {
  QdrantSdkClient,
  QdrantSdkClientFactory,
} from "../services/qdrant-knowledge-vector-store";

export function qdrantSdkClientFactoryFromFetch(
  fetchImpl: typeof fetch,
): QdrantSdkClientFactory {
  return ({ apiKey, url }) => {
    const request = async (
      collection: string,
      path: string,
      method: "GET" | "POST" | "PUT",
      body?: unknown,
    ): Promise<unknown> => {
      const endpoint = new URL(
        `/collections/${encodeURIComponent(collection)}${path}`,
        url,
      );
      const response = await fetchImpl(endpoint, {
        method,
        headers: {
          "api-key": apiKey,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data = await response.json().catch(() => undefined);
      if (!response.ok) {
        throw QdrantClientUnexpectedResponseError.forResponse({
          data,
          headers: response.headers,
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          url: response.url,
        });
      }
      const envelope = asRecord(data);
      return envelope?.result ?? data;
    };

    return {
      upsert: (collection, input) =>
        request(collection, "/points?wait=true", "PUT", input),
      query: (collection, input) =>
        request(collection, "/points/query", "POST", input),
      delete: (collection, input) =>
        request(collection, "/points/delete?wait=true", "POST", input),
      getCollection: (collection) => request(collection, "", "GET"),
    } as QdrantSdkClient;
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

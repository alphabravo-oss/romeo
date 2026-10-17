import { dnsPinnedFetch, type DnsPinnedFetch } from "./dns-pinned-fetch";
import { networkAddressFamily } from "./network-host-policy";
import {
  isRedirectResponse,
  lookupNetworkHost,
  type WebsiteConnectorHostAddress,
  type WebsiteConnectorHostLookup,
} from "./outbound-network-policy";
import {
  assertProviderAddressesAllowed,
  evaluateProviderDestination,
  ProviderEgressBlockedError,
  type ProviderNetworkPolicy,
} from "./provider-network-policy";

const defaultMaxRedirects = 5;
const credentialHeaderNames = [
  "api-key",
  "authorization",
  "cookie",
  "proxy-authorization",
  "x-api-key",
  "x-goog-api-key",
] as const;

export interface ProviderEgressFetchOptions {
  /** Test-only raw transport. Production callers leave this unset. */
  fetchImpl?: typeof fetch;
  hostLookup?: WebsiteConnectorHostLookup;
  maxRedirects?: number;
  pinnedFetchImpl?: DnsPinnedFetch;
  policy: ProviderNetworkPolicy;
}

/**
 * The transport every model-provider request uses (verify, catalog sync,
 * chat, embeddings, images, Ollama model management). Each hop is checked
 * against the provider network policy, every DNS answer is validated, and the
 * production socket is pinned to the approved answer so a rebinding resolver
 * cannot swap in an internal address between check and connect. Response
 * bodies stream through untouched; deadlines stay with the caller's signal.
 */
export function createProviderEgressFetch(
  options: ProviderEgressFetchOptions,
): typeof fetch {
  const usesProductionTransport =
    options.fetchImpl === undefined || options.fetchImpl === fetch;
  const fetchImpl = options.fetchImpl ?? fetch;
  const hostLookup =
    options.hostLookup ??
    (usesProductionTransport ? lookupNetworkHost : undefined);
  const pinnedFetchImpl =
    options.pinnedFetchImpl ??
    (usesProductionTransport ? dnsPinnedFetch : undefined);
  const maxRedirects = options.maxRedirects ?? defaultMaxRedirects;

  const approve = async (
    url: URL,
    signal: AbortSignal | undefined,
  ): Promise<WebsiteConnectorHostAddress[]> => {
    const destination = evaluateProviderDestination(options.policy, url);
    const literalFamily = networkAddressFamily(destination.host);
    if (literalFamily !== undefined) {
      const literal = { address: destination.host, family: literalFamily };
      assertProviderAddressesAllowed(options.policy, destination, [
        literal.address,
      ]);
      return [literal];
    }
    if (hostLookup === undefined) return [];
    let addresses: WebsiteConnectorHostAddress[];
    try {
      addresses = await abortable(hostLookup(destination.host), signal);
    } catch (error) {
      if (signal?.aborted === true) throw error;
      throw new ProviderEgressBlockedError("dns_lookup_failed");
    }
    if (
      addresses.some(
        (address) => networkAddressFamily(address.address) !== address.family,
      )
    )
      throw new ProviderEgressBlockedError("dns_lookup_failed");
    assertProviderAddressesAllowed(
      options.policy,
      destination,
      addresses.map((address) => address.address),
    );
    return addresses;
  };

  return async (resource, init) => {
    const request = resource instanceof Request ? resource : undefined;
    let url = new URL(
      request?.url ??
        (resource instanceof URL ? resource.href : String(resource)),
    );
    const redirectMode = init?.redirect ?? request?.redirect ?? "follow";
    const signal = init?.signal ?? request?.signal ?? undefined;
    let current: { input: RequestInfo | URL; init: RequestInit } = {
      input: resource,
      init: { ...init },
    };
    for (let redirectCount = 0; ; redirectCount += 1) {
      const addresses = await approve(url, signal);
      const hopInit: RequestInit = { ...current.init, redirect: "manual" };
      const response =
        addresses.length > 0 && pinnedFetchImpl !== undefined
          ? await pinnedFetchImpl(
              url,
              await bufferedInit(current.input, hopInit),
              addresses,
            )
          : await fetchImpl(current.input, hopInit);
      if (!isRedirectResponse(response) || redirectMode === "manual")
        return response;
      const location = response.headers.get("location");
      if (location === null) return response;
      await response.body?.cancel().catch(() => undefined);
      if (redirectMode === "error" || redirectCount >= maxRedirects)
        throw new TypeError("Model provider redirect was not followed.");
      const next = new URL(location, url);
      current = {
        input: next,
        init: await redirectInit(current.input, current.init, {
          crossOrigin: next.origin !== url.origin,
          status: response.status,
        }),
      };
      url = next;
    }
  };
}

/**
 * The pinned transport writes a buffered body; Request inputs and stream,
 * Blob, or FormData bodies are materialized here (keeping the multipart
 * boundary header) so callers never need to care which transport runs.
 */
async function bufferedInit(
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<RequestInit> {
  const request = input instanceof Request ? input : undefined;
  const body = init.body ?? undefined;
  const bufferable =
    body === undefined ||
    typeof body === "string" ||
    body instanceof URLSearchParams ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body);
  let headers = new Headers(init.headers ?? request?.headers);
  let buffered: BodyInit | undefined = body;
  if (request !== undefined && init.body === undefined && request.body) {
    buffered = new Uint8Array(await request.clone().arrayBuffer());
  } else if (!bufferable) {
    const materialized = new Request("http://romeo.invalid/", {
      body,
      headers,
      method: init.method ?? request?.method ?? "POST",
      duplex: "half",
    } as RequestInit);
    headers = materialized.headers;
    buffered = new Uint8Array(await materialized.arrayBuffer());
  }
  // The pinned socket does not decompress; ask for an identity response.
  headers.set("accept-encoding", "identity");
  const rest: RequestInit = { ...init };
  delete rest.body;
  return {
    ...rest,
    headers,
    method: init.method ?? request?.method ?? "GET",
    ...(buffered === undefined ? {} : { body: buffered }),
  };
}

async function redirectInit(
  input: RequestInfo | URL,
  init: RequestInit,
  redirect: { crossOrigin: boolean; status: number },
): Promise<RequestInit> {
  const request = input instanceof Request ? input : undefined;
  const method = (init.method ?? request?.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers ?? request?.headers);
  if (redirect.crossOrigin)
    for (const name of credentialHeaderNames) headers.delete(name);
  const next: RequestInit = { ...init, headers };
  delete next.body;
  if (
    redirect.status === 303 ||
    ((redirect.status === 301 || redirect.status === 302) && method === "POST")
  ) {
    headers.delete("content-type");
    headers.delete("content-length");
    return { ...next, method: method === "HEAD" ? "HEAD" : "GET" };
  }
  const body =
    init.body ??
    (request?.body == null
      ? undefined
      : new Uint8Array(await request.clone().arrayBuffer()));
  return { ...next, method, ...(body === undefined ? {} : { body }) };
}

async function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (signal === undefined) return await promise;
  if (signal.aborted) throw signal.reason;
  return await new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    void promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

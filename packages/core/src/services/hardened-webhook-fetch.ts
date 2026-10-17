import { ApiError } from "../errors";
import {
  assertConnectorHostAllowed,
  isRedirectResponse,
  type WebsiteConnectorEgressPolicy,
  type WebsiteConnectorHostLookup,
} from "./outbound-network-policy";
import { dnsPinnedFetch, type DnsPinnedFetch } from "./dns-pinned-fetch";

export interface HardenedWebhookFetchOptions {
  allowedHosts?: string[];
  egressPolicy?: WebsiteConnectorEgressPolicy;
  fetchImpl?: typeof fetch;
  hostLookup?: WebsiteConnectorHostLookup;
  maxRedirects?: number;
  maxResponseBytes?: number;
  pinnedFetchImpl?: DnsPinnedFetch;
  timeoutMs?: number;
}

/**
 * Shared egress boundary for outbound webhook-shaped delivery. Every redirect
 * is re-authorized and re-resolved, production sockets can be pinned to the
 * approved DNS answer, and response bodies are bounded before an adapter sees
 * them.
 */
export async function hardenedWebhookFetch(
  target: string | URL,
  init: RequestInit,
  options: HardenedWebhookFetchOptions = {},
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const pinnedFetchImpl =
    options.pinnedFetchImpl ??
    (options.fetchImpl === undefined && options.hostLookup !== undefined
      ? dnsPinnedFetch
      : undefined);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort("webhook_delivery_timeout"),
    options.timeoutMs ?? 10_000,
  );
  timeout.unref?.();
  let currentUrl = new URL(target);
  try {
    for (let redirectCount = 0; ; redirectCount += 1) {
      assertHttpsUrl(currentUrl);
      const approvedAddresses = await assertConnectorHostAllowed(currentUrl, {
        ...(options.allowedHosts === undefined
          ? {}
          : { allowedHosts: options.allowedHosts }),
        ...(options.egressPolicy === undefined
          ? {}
          : { egressPolicy: options.egressPolicy }),
        ...(options.hostLookup === undefined
          ? {}
          : { hostLookup: options.hostLookup }),
      });
      const requestInit: RequestInit = {
        ...init,
        redirect: "manual",
        signal: controller.signal,
      };
      const response =
        pinnedFetchImpl === undefined || approvedAddresses.length === 0
          ? await fetchImpl(currentUrl.toString(), requestInit)
          : await pinnedFetchImpl(currentUrl, requestInit, approvedAddresses);
      if (!isRedirectResponse(response)) {
        return boundedResponse(response, options.maxResponseBytes ?? 65_536);
      }

      const location = response.headers.get("location");
      await cancelResponseBody(response);
      if (location === null) {
        return new Response(null, {
          headers: response.headers,
          status: response.status,
          statusText: response.statusText,
        });
      }
      if (redirectCount >= (options.maxRedirects ?? 5)) {
        throw new ApiError(
          "webhook_redirect_limit_exceeded",
          "Webhook delivery exceeded the redirect limit.",
          502,
        );
      }
      currentUrl = new URL(location, currentUrl);
    }
  } finally {
    clearTimeout(timeout);
  }
}

function assertHttpsUrl(url: URL): void {
  if (
    url.protocol !== "https:" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.hash.length > 0
  ) {
    throw new ApiError(
      "invalid_webhook_url",
      "Webhook delivery URLs and redirects must use credential-free HTTPS.",
      400,
    );
  }
}

async function boundedResponse(
  response: Response,
  maxBytes: number,
): Promise<Response> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await cancelResponseBody(response);
    throw new TypeError("Webhook response exceeded the byte limit.");
  }
  if (response.body === null) return response;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("webhook_response_too_large");
        throw new TypeError("Webhook response exceeded the byte limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const bodyless = [101, 204, 205, 304].includes(response.status);
  return new Response(bodyless ? null : body, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Delivery status is already known; body disposal is best-effort cleanup.
  }
}

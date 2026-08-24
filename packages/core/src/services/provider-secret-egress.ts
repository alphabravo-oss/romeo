import type { ProviderInstance } from "@romeo/providers";

import { compatibilityProviderFetch } from "./compatibility-provider-egress";
import { SecretBearingEgressError } from "./secret-bearing-egress";

const sensitiveHeaderNames = [
  "api-key",
  "authorization",
  "cookie",
  "proxy-authorization",
  "x-api-key",
] as const;

/**
 * Routes each native provider request through the exact reviewed origin for
 * the credential resolved for that provider. Credential-free local providers
 * retain their explicit transport, while any unexpected secret-bearing
 * destination fails closed instead of falling back to raw fetch.
 */
export function governedProviderFetch(input: {
  fetchImpl?: typeof fetch;
  providerApiKeys: Readonly<Record<string, string>>;
  providers: readonly (ProviderInstance | undefined)[];
  timeoutMs: number;
}): typeof fetch {
  const rawFetch = input.fetchImpl ?? fetch;
  const guardedByOrigin = new Map<string, typeof fetch>();
  for (const provider of input.providers) {
    if (
      provider === undefined ||
      input.providerApiKeys[provider.id] === undefined
    )
      continue;
    const guarded = compatibilityProviderFetch({
      credentialPresent: true,
      fetchImpl: rawFetch,
      maxResponseBytes: 8 * 1024 * 1024,
      provider,
      responseMode: "streaming",
      timeoutMs: input.timeoutMs,
    });
    if (guarded !== undefined)
      guardedByOrigin.set(new URL(provider.baseUrl).origin, guarded);
  }

  return async (resource, init) => {
    const request = resource instanceof Request ? resource : undefined;
    const url = new URL(
      request?.url ??
        (resource instanceof URL ? resource.href : String(resource)),
    );
    const guarded = guardedByOrigin.get(url.origin);
    if (guarded !== undefined) return guarded(resource, init);
    if (hasSensitiveHeaders(request, init))
      throw new SecretBearingEgressError("secret_egress_destination_blocked");
    return rawFetch(resource, init);
  };
}

function hasSensitiveHeaders(
  request: Request | undefined,
  init: RequestInit | undefined,
): boolean {
  const headers = new Headers(request?.headers);
  new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
  return sensitiveHeaderNames.some((name) => headers.has(name));
}

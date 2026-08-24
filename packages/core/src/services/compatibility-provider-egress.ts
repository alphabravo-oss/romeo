import type { ProviderInstance } from "@romeo/providers";

import {
  SecretBearingEgressClient,
  SecretBearingEgressError,
} from "./secret-bearing-egress";

const maximumSecretEgressTimeoutMs = 120_000;

/**
 * Provider requests carrying a resolved credential never use a raw transport
 * in production. The configured provider origin is the tenant-approved
 * destination; DNS policy then rejects private/mixed answers and pins the
 * socket while preserving TLS identity. Credential-free local providers keep
 * their explicitly configured transport behavior.
 */
export function compatibilityProviderFetch(input: {
  credentialPresent: boolean;
  fetchImpl?: typeof fetch;
  maxResponseBytes?: number;
  provider: ProviderInstance;
  responseMode?: "buffered" | "streaming";
  timeoutMs: number;
}): typeof fetch | undefined {
  if (!input.credentialPresent) return input.fetchImpl;
  let origin: string;
  try {
    origin = new URL(input.provider.baseUrl).origin;
  } catch {
    throw new SecretBearingEgressError("secret_egress_url_invalid");
  }
  return new SecretBearingEgressClient({
    allowedOrigins: [origin],
    ...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl }),
    maxResponseBytes: input.maxResponseBytes ?? 2 * 1024 * 1024,
    responseMode: input.responseMode ?? "buffered",
    timeoutMs: Math.min(
      maximumSecretEgressTimeoutMs,
      Math.max(1, input.timeoutMs),
    ),
  }).fetch;
}

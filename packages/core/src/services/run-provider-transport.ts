import type { BaseModel, ProviderInstance } from "@romeo/providers";

import { governedProviderFetch } from "./provider-secret-egress";
import { resolveRunProviderApiKeys } from "./run-provider-api-keys";
import { providerTimeoutFields } from "./run-provider-timeout";
import type { RunServiceOptions } from "./run-service-contracts";

/** Resolves provider secrets, timeout and the governed fetch for one run. */
export async function resolveRunProviderTransport(
  input: {
    model: BaseModel;
    provider: ProviderInstance;
    routePlan: { fallback?: { provider: ProviderInstance } | undefined };
  },
  options: RunServiceOptions,
) {
  const providers = [input.provider, input.routePlan.fallback?.provider];
  const providerApiKeys = await resolveRunProviderApiKeys(
    providers,
    options.secretResolver,
  );
  const providerTimeout = providerTimeoutFields(
    options.providerStreamTimeoutMs,
    input.model,
  );
  const providerFetch = governedProviderFetch({
    fetchImpl: options.providerFetch ?? fetch,
    providerApiKeys,
    providers,
    timeoutMs:
      "providerTimeoutMs" in providerTimeout
        ? providerTimeout.providerTimeoutMs
        : 60_000,
  });
  return { providerApiKeys, providerFetch, providerTimeout };
}

import type { ProviderInstance } from "@romeo/providers";

import type { RunServiceOptions } from "./run-service-contracts";

export async function resolveRunProviderApiKeys(
  providers: Array<ProviderInstance | undefined>,
  secretResolver: RunServiceOptions["secretResolver"],
): Promise<Record<string, string>> {
  const unique = [
    ...new Map(
      providers
        .filter(
          (provider): provider is ProviderInstance => provider !== undefined,
        )
        .map((provider) => [provider.id, provider]),
    ).values(),
  ];
  const entries = await Promise.all(
    unique.map(async (provider) => {
      if (provider.credentialRef === undefined) return undefined;
      const resolution = await secretResolver?.resolveValue?.(
        provider.credentialRef,
      );
      return resolution?.available === true
        ? ([provider.id, resolution.value] as const)
        : undefined;
    }),
  );
  return Object.fromEntries(
    entries.filter(
      (entry): entry is readonly [string, string] => entry !== undefined,
    ),
  );
}

export type CapabilityProvenance = "advertised" | "detected" | "probed" | "override";

export interface ProviderCapabilityRecord {
  value: unknown;
  source: CapabilityProvenance;
  updatedAt: string;
  sourceVersion: string;
}

export function mergeProviderCapabilityRecords(input: {
  current?: ProviderCapabilityRecord;
  incoming: ProviderCapabilityRecord;
}): ProviderCapabilityRecord {
  if (input.current?.source === "override" && input.incoming.source !== "override")
    return input.current;
  return input.incoming;
}

export function evaluateProviderProbe(input: {
  advertised: boolean;
  probed: boolean;
}): { outcome: "match" } | { outcome: "mismatch"; code: "provider_probe_mismatch" } {
  if (input.advertised === input.probed) return { outcome: "match" };
  return { outcome: "mismatch", code: "provider_probe_mismatch" };
}

export function omitUnsupportedProviderKnobs<T extends Record<string, unknown>>(input: {
  requested: T;
  supported: ReadonlySet<keyof T>;
}): { effective: Partial<T>; omitted: Array<keyof T> } {
  const effective: Partial<T> = {};
  const omitted: Array<keyof T> = [];
  for (const [key, value] of Object.entries(input.requested) as Array<
    [keyof T, T[keyof T]]
  >) {
    if (input.supported.has(key)) effective[key] = value;
    else omitted.push(key);
  }
  return { effective, omitted };
}

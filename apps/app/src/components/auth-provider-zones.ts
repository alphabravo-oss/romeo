/**
 * Split a closed catalog of singleton provider slots into operational zones.
 * Configured or enabled slots remain active; untouched implemented slots can
 * be claimed; planned slots are visible but unavailable.
 */
export interface ProviderZoneInput {
  id: string;
  configured: boolean;
  enabled: boolean;
  status: "implemented" | "planned";
}

export interface ProviderZones<T> {
  active: T[];
  available: T[];
  unavailable: T[];
}

export function splitProviderZones<T extends ProviderZoneInput>(
  rows: readonly T[],
): ProviderZones<T> {
  const zones: ProviderZones<T> = {
    active: [],
    available: [],
    unavailable: [],
  };
  for (const entry of rows) {
    if (entry.configured || entry.enabled) {
      zones.active.push(entry);
    } else if (entry.status === "planned") {
      zones.unavailable.push(entry);
    } else {
      zones.available.push(entry);
    }
  }
  return zones;
}

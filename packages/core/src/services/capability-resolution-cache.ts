import type { CapabilityId } from "./capability-definition-registry";
import type {
  CapabilityLayer,
  EffectiveCapability,
} from "./capability-resolution-model";

export type CapabilityCacheRisk = "low" | "medium" | "high" | "critical";

export interface CapabilityResolutionCacheKey {
  orgId: string;
  workspaceId?: string;
  subjectId?: string;
  grantVersion: string;
  policyVersion: string;
  capabilityId: CapabilityId;
  healthVersion: string;
  registryVersion: string;
  /**
   * Fingerprint of the caller's requested values. The requested payload changes
   * both requestedChanges and status, so leaving it out of the key replayed one
   * caller's decision for a differently-parameterized request -- letting an
   * over-limit value through on the back of an earlier compliant one.
   */
  requestedVersion: string;
}

export interface CapabilityResolutionCacheEntry {
  key: CapabilityResolutionCacheKey;
  value: EffectiveCapability;
  storedAt: string;
  expiresAt: string;
}

export type CapabilityCacheRead =
  | { outcome: "hit"; value: EffectiveCapability }
  | { outcome: "miss" }
  | { outcome: "stale_fail"; code: "capability_resolution_stale" };

export function capabilityResolutionCacheKey(
  input: CapabilityResolutionCacheKey,
): string {
  return [
    input.orgId,
    input.workspaceId ?? "",
    input.subjectId ?? "",
    input.grantVersion,
    input.policyVersion,
    input.capabilityId,
    input.healthVersion,
    input.registryVersion,
    input.requestedVersion,
  ].join("\0");
}

/**
 * Stable fingerprint of a requested capability payload. Keys are sorted so two
 * structurally equal requests share a cache entry regardless of property order.
 */
export function requestedCapabilityVersion(requested: unknown): string {
  if (requested === undefined) return "";
  return JSON.stringify(requested, (_key, value: unknown) =>
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? Object.fromEntries(
          Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : value,
  );
}

export function assignmentPolicyVersion(
  versions: Array<{ layer: CapabilityLayer; version: number }>,
): string {
  return versions
    .map((item) => `${item.layer}:${item.version}`)
    .join(",");
}

export function readCapabilityResolutionCache(input: {
  entry?: CapabilityResolutionCacheEntry;
  key: CapabilityResolutionCacheKey;
  now: string;
  risk: CapabilityCacheRisk;
}): CapabilityCacheRead {
  if (input.entry === undefined) return { outcome: "miss" };
  const sameKey =
    capabilityResolutionCacheKey(input.entry.key) ===
    capabilityResolutionCacheKey(input.key);
  // Date.parse returns NaN for unparseable input and every NaN comparison is
  // false, so a plain `expiresAt <= now` treats a corrupt timestamp as fresh.
  // Count unparseable as expired and let the risk branch below fail closed.
  const expiresAt = Date.parse(input.entry.expiresAt);
  const now = Date.parse(input.now);
  const expired =
    !Number.isFinite(expiresAt) ||
    !Number.isFinite(now) ||
    expiresAt <= now;
  if (sameKey && !expired) return { outcome: "hit", value: input.entry.value };
  if (input.risk === "high" || input.risk === "critical")
    return { outcome: "stale_fail", code: "capability_resolution_stale" };
  return { outcome: "miss" };
}

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
  ].join("\0");
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
  const expired = Date.parse(input.entry.expiresAt) <= Date.parse(input.now);
  if (sameKey && !expired) return { outcome: "hit", value: input.entry.value };
  if (input.risk === "high" || input.risk === "critical")
    return { outcome: "stale_fail", code: "capability_resolution_stale" };
  return { outcome: "miss" };
}

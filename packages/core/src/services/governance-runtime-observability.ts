import { apiDeprecationUsageStore } from "./api-deprecation-observability";
import { capabilityFlagUsageStore } from "./capability-flag-observability";
import { capabilityResolutionUsageStore } from "./capability-resolution-observability";
import { idempotencyUsageStore } from "./idempotency-observability";

export interface GovernanceRuntimeUsageSnapshot {
  apiDeprecations: ReturnType<typeof apiDeprecationUsageStore.snapshot>;
  capabilityAssignments: ReturnType<
    typeof capabilityResolutionUsageStore.snapshot
  >;
  capabilityFlags: ReturnType<typeof capabilityFlagUsageStore.snapshot>;
  idempotency: ReturnType<typeof idempotencyUsageStore.snapshot>;
}

export function governanceRuntimeUsageSnapshot(
  apiDeprecations: GovernanceRuntimeUsageSnapshot["apiDeprecations"],
): GovernanceRuntimeUsageSnapshot {
  return {
    apiDeprecations,
    capabilityAssignments: capabilityResolutionUsageStore.snapshot(),
    capabilityFlags: capabilityFlagUsageStore.snapshot(),
    idempotency: idempotencyUsageStore.snapshot(),
  };
}

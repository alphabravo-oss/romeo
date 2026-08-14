import type { CapabilityId } from "./capability-definition-registry";
import type { EffectiveCapability } from "./capability-resolution-model";

export interface CapabilityResolutionUsageSnapshot {
  observationScope: "process";
  resolutions: Array<{
    capabilityId: CapabilityId;
    status: EffectiveCapability["status"];
    count: number;
  }>;
  total: number;
}

export class CapabilityResolutionUsageStore {
  private readonly counts = new Map<
    string,
    CapabilityResolutionUsageSnapshot["resolutions"][number]
  >();
  private total = 0;

  record(value: EffectiveCapability): void {
    const key = `${value.capabilityId}\u001f${value.status}`;
    const current = this.counts.get(key);
    this.counts.set(key, {
      capabilityId: value.capabilityId,
      status: value.status,
      count: (current?.count ?? 0) + 1,
    });
    this.total += 1;
  }

  snapshot(): CapabilityResolutionUsageSnapshot {
    return {
      observationScope: "process",
      resolutions: [...this.counts.values()]
        .map((entry) => ({ ...entry }))
        .sort(
          (left, right) =>
            left.capabilityId.localeCompare(right.capabilityId) ||
            left.status.localeCompare(right.status),
        ),
      total: this.total,
    };
  }

  reset(): void {
    this.counts.clear();
    this.total = 0;
  }
}

export const capabilityResolutionUsageStore =
  new CapabilityResolutionUsageStore();

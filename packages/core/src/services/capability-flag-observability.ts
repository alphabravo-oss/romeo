import type { CapabilityFlagId } from "@romeo/contracts";

import type { EffectiveCapabilityFlag } from "./organization-capability-flag-service";

export interface CapabilityFlagUsageSnapshot {
  observationScope: "process";
  resolutions: Array<{
    flagId: CapabilityFlagId;
    reasonCode: EffectiveCapabilityFlag["reasonCode"];
    effectiveState: EffectiveCapabilityFlag["effectiveState"];
    count: number;
  }>;
  total: number;
}

export class CapabilityFlagUsageStore {
  private readonly counts = new Map<
    string,
    CapabilityFlagUsageSnapshot["resolutions"][number]
  >();
  private total = 0;

  record(value: EffectiveCapabilityFlag): void {
    const key = `${value.flagId}\u001f${value.effectiveState}\u001f${value.reasonCode}`;
    const current = this.counts.get(key);
    this.counts.set(key, {
      flagId: value.flagId,
      effectiveState: value.effectiveState,
      reasonCode: value.reasonCode,
      count: (current?.count ?? 0) + 1,
    });
    this.total += 1;
  }

  snapshot(): CapabilityFlagUsageSnapshot {
    return {
      observationScope: "process",
      resolutions: [...this.counts.values()]
        .map((entry) => ({ ...entry }))
        .sort(
          (left, right) =>
            left.flagId.localeCompare(right.flagId) ||
            left.effectiveState.localeCompare(right.effectiveState) ||
            left.reasonCode.localeCompare(right.reasonCode),
        ),
      total: this.total,
    };
  }

  reset(): void {
    this.counts.clear();
    this.total = 0;
  }
}

export const capabilityFlagUsageStore = new CapabilityFlagUsageStore();

import type { EffectiveCapability } from "./capability-resolution-model";

export interface CapabilityImpactSample {
  role: string;
  workspaceClass: string;
  agentClass?: string;
  dataClass?: string;
  effective: EffectiveCapability;
}

export interface CapabilityImpactPreview {
  sampleCount: number;
  counts: Record<EffectiveCapability["status"], number>;
  reasons: Array<{
    code: EffectiveCapability["reasons"][number]["code"];
    layer: EffectiveCapability["reasons"][number]["layer"];
    count: number;
  }>;
}

const emptyCounts = (): CapabilityImpactPreview["counts"] => ({
  enabled: 0,
  disabled: 0,
  required: 0,
  normalized: 0,
  not_configured: 0,
  not_entitled: 0,
  not_allowed: 0,
  unsupported: 0,
  unhealthy: 0,
});

export function summarizeCapabilityImpact(
  samples: CapabilityImpactSample[],
): CapabilityImpactPreview {
  const counts = emptyCounts();
  const reasonCounts = new Map<string, CapabilityImpactPreview["reasons"][number]>();
  for (const sample of samples) {
    counts[sample.effective.status] += 1;
    for (const reason of sample.effective.reasons) {
      const key = `${reason.code}:${reason.layer}`;
      const existing = reasonCounts.get(key);
      if (existing === undefined) {
        reasonCounts.set(key, {
          code: reason.code,
          layer: reason.layer,
          count: 1,
        });
        continue;
      }
      existing.count += 1;
    }
  }
  return {
    sampleCount: samples.length,
    counts,
    reasons: [...reasonCounts.values()].sort(
      (left, right) =>
        right.count - left.count ||
        left.code.localeCompare(right.code) ||
        left.layer.localeCompare(right.layer),
    ),
  };
}

export function assertImpactPreviewPrivacy(preview: CapabilityImpactPreview): void {
  const serialized = JSON.stringify(preview);
  if (
    /user_|email|@|secret|prompt|content|principal/i.test(serialized) &&
    /user_[a-z0-9]+/i.test(serialized)
  ) {
    throw new Error("Capability impact preview leaked identity or content.");
  }
}

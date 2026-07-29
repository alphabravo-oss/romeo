/**
 * Time scope for consumption and audit views. The reference instant is a
 * parameter rather than an internal `new Date()` so behavior is testable
 * without freezing the clock.
 */
export const RANGE_PRESETS = ["24h", "7d", "30d", "90d", "all"] as const;

export type RangePreset = (typeof RANGE_PRESETS)[number];

const DAYS: Record<Exclude<RangePreset, "all">, number> = {
  "24h": 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

export function rangeToBounds(
  preset: RangePreset,
  now: Date,
): { from: Date | undefined; to: Date } {
  if (preset === "all") return { from: undefined, to: now };
  const from = new Date(now.getTime() - DAYS[preset] * 24 * 60 * 60 * 1000);
  return { from, to: now };
}

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

/**
 * Bounds are floored to the minute.
 *
 * Callers put these in a react-query key, and a raw `new Date()` makes the key
 * change on every render — which fired ~150 requests/second at the audit API
 * until the server rate-limited it and the page never left its loading
 * skeleton. Quantising here protects every caller rather than asking each one
 * to remember; a minute is far finer than any range this selects.
 */
const MINUTE_MS = 60_000;

export function rangeToBounds(
  preset: RangePreset,
  now: Date,
): { from: Date | undefined; to: Date } {
  const to = new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS);
  if (preset === "all") return { from: undefined, to };
  const from = new Date(to.getTime() - DAYS[preset] * 24 * 60 * 60 * 1000);
  return { from, to };
}

import type { SeedData } from "./seed-data";

export function removeSeedRecords<T>(
  data: SeedData,
  counts: Record<string, number>,
  key: keyof SeedData,
  predicate: (item: T) => boolean,
): void {
  const values = data[key] as T[];
  const kept = values.filter((item) => !predicate(item));
  counts[String(key)] = values.length - kept.length;
  (data as Record<keyof SeedData, unknown>)[key] = kept;
}

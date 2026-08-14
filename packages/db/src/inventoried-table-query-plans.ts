import { inventoriedTableIndexInventory } from "./inventoried-table-indexes";

export function reviewInventoriedTableQueryPlan(input: {
  expectedIndexes: readonly string[];
  observedIndexes: readonly string[];
  representativeVolume: boolean;
  sequentialScan: boolean;
}):
  | { outcome: "accepted" }
  | {
      code: "missing_expected_index" | "sequential_scan_at_volume";
      outcome: "denied";
    } {
  const observed = new Set(input.observedIndexes);
  const missing = input.expectedIndexes.filter((index) => !observed.has(index));
  if (input.representativeVolume && missing.length > 0)
    return { code: "missing_expected_index", outcome: "denied" };
  if (input.representativeVolume && input.sequentialScan)
    return { code: "sequential_scan_at_volume", outcome: "denied" };
  return { outcome: "accepted" };
}

export function inventoriedTablePlanExpectation(resource: string) {
  const expected =
    inventoriedTableIndexInventory[
      resource as keyof typeof inventoriedTableIndexInventory
    ];
  return expected === undefined ? undefined : [...expected];
}
